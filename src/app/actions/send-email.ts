'use server';

/**
 * Outbound mail.
 *
 * Transports are tried in order until one accepts the message:
 *
 *   1. Gmail SMTP                 — the sender is a Gmail address
 *   2. Resend HTTP API            — RESEND_API_KEY is set (business domains)
 *   3. The mailbox's own SMTP     — the account has a password + SMTP host saved
 *   4. SMTP relay                 — SMTP_HOST / SMTP_USER / SMTP_PASS
 *   5. Gmail relay with Reply-To  — last resort, GMAIL_USER / GMAIL_APP_PASSWORD,
 *                                   disable with ALLOW_GMAIL_RELAY=false
 *
 * Before any transport is tried, every recipient domain must be able to
 * receive mail (see recipient-check.ts): providers accept mail for domains
 * that do not exist and bounce it minutes later, after the console has
 * already said "Sent".
 *
 * Success is only reported when a transport accepted the message. Every
 * attempt's failure is kept and returned, so "nothing was sent" always comes
 * with the reason each route refused. Acceptance is not delivery: the sent
 * copy records the transport's id, and delivery.ts follows it to
 * delivered / bounced.
 */

import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { eq, or } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { accounts, emails, type Account, type NewEmail } from '../../db/schema.ts';
import { mailboxPassword, readMailboxConfig } from '../../lib/secrets.ts';
import { storeEmail } from '../../lib/store-email.ts';
import { checkRecipients, describeProblems, isValidAddress, type RecipientCheck } from '../../lib/recipient-check.ts';
import { knownDomains } from '../../lib/contacts.ts';
import { resendApi, resendConfigured } from '../../lib/resend.ts';

export interface SendAttachment {
  filename: string;
  /** base64 content */
  content: string;
  contentType?: string;
}

export interface SendEmailParams {
  accountId: string;
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  htmlBody: string;
  /** Id of the stored email being replied to; adds threading headers. */
  inReplyToId?: string;
  /** Where replies should go, when not to the sender (an agent's +alias). */
  replyTo?: string;
  attachments?: SendAttachment[];
  fromName?: string;
  /** Skip the recipient DNS check (only for addresses already proven deliverable). */
  skipRecipientCheck?: boolean;
}

export interface SendEmailResponse {
  success: boolean;
  messageId?: string;
  /** Id of the stored Sent copy, for delivery tracking. */
  emailId?: string;
  /** 'sent' once accepted; delivery.ts moves it on. */
  deliveryStatus?: string;
  /** True when the transport reports delivery events (Resend). */
  trackable?: boolean;
  recipientChecks?: RecipientCheck[];
  dispatchedAt?: string;
  provider?: string;
  error?: string;
  attempts?: Array<{ provider: string; error: string }>;
}

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** Splits a recipient field into addresses, keeping the entries that are not valid ones. */
const parseEmailList = (raw?: string | string[]): { valid: string[]; invalid: string[] } => {
  if (!raw) return { valid: [], invalid: [] };
  const parts = Array.isArray(raw) ? raw : String(raw).split(/[,;\n]+/);
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const r of parts) {
    const t = String(r).trim();
    if (!t) continue;
    const angle = t.match(/<([^>]+)>/);
    const addr = (angle ? angle[1] : t).trim().toLowerCase();
    if (isValidAddress(addr)) {
      if (!valid.includes(addr)) valid.push(addr);
    } else invalid.push(t);
  }
  return { valid, invalid };
};

const htmlToText = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

function gmailPasswords(): Map<string, string> {
  const map = new Map<string, string>();
  const add = (u?: string, p?: string) => { if (u?.trim() && p?.trim()) map.set(u.trim().toLowerCase(), p.trim()); };
  add(process.env.GMAIL_USER, process.env.GMAIL_APP_PASSWORD);
  add(process.env.BACKUPE9_USER, process.env.BACKUPE9_APP_PASSWORD);
  return map;
}

const isGmail = (addr: string) => /@(gmail|googlemail)\.com$/i.test(addr);

/** SMTP host for a mailbox, when one can be inferred from the account settings. */
function mailboxSmtp(acc: Account | undefined): { host: string; port: number } | null {
  if (!acc) return null;
  const cfg = readMailboxConfig(acc.oauth_tokens);
  if (cfg.smtp_host) return { host: cfg.smtp_host, port: cfg.smtp_port || 465 };
  const imap = cfg.imap_host || '';
  if (imap.includes('zoho')) return { host: imap.replace('imap', 'smtp'), port: 465 };
  if (imap.includes('office365') || imap.includes('outlook')) return { host: 'smtp.office365.com', port: 587 };
  return null;
}

interface Envelope {
  from: string;
  fromName: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  html: string;
  text: string;
  messageId: string;
  replyTo?: string;
  headers: Record<string, string>;
  attachments: SendAttachment[];
}

async function viaSmtp(
  env: Envelope,
  server: { host: string; port: number; user?: string; pass?: string },
  overrides: { from?: string; replyTo?: string } = {}
) {
  const isLocal = /^(localhost|127\.|::1|0\.0\.0\.0)/.test(server.host);
  const transporter = nodemailer.createTransport({
    host: server.host,
    port: server.port,
    secure: server.port === 465,
    ...(server.user ? { auth: { user: server.user, pass: server.pass } } : {}),
    tls: { rejectUnauthorized: !isLocal },
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });
  const info = await transporter.sendMail({
    from: overrides.from ?? `"${env.fromName}" <${env.from}>`,
    to: env.to,
    cc: env.cc.length ? env.cc : undefined,
    bcc: env.bcc.length ? env.bcc : undefined,
    replyTo: overrides.replyTo ?? env.replyTo,
    subject: env.subject,
    html: env.html,
    text: env.text,
    messageId: env.messageId,
    headers: env.headers,
    attachments: env.attachments.map((a) => ({
      filename: a.filename,
      content: Buffer.from(a.content, 'base64'),
      contentType: a.contentType,
    })),
  });
  return info.messageId || env.messageId;
}

interface Accepted { messageId: string; providerId?: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Resend HTTP API. Transient failures (rate limit, 5xx, network) are retried
 * with the same Idempotency-Key, so a retry after a lost response cannot send
 * the message twice.
 */
async function viaResend(env: Envelope): Promise<Accepted> {
  const payload = {
    from: `"${env.fromName.replace(/["\\]/g, '')}" <${env.from}>`,
    to: env.to,
    cc: env.cc.length ? env.cc : undefined,
    bcc: env.bcc.length ? env.bcc : undefined,
    reply_to: env.replyTo ? [env.replyTo] : undefined,
    subject: env.subject,
    html: env.html,
    text: env.text,
    headers: { ...env.headers, 'Message-ID': env.messageId },
    attachments: env.attachments.length
      ? env.attachments.map((a) => ({ filename: a.filename, content: a.content, content_type: a.contentType }))
      : undefined,
  };

  let lastError = 'unknown error';
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(attempt === 1 ? 800 : 2500);
    let res;
    try {
      res = await resendApi<{ id?: string }>('/emails', {
        method: 'POST',
        headers: { 'Idempotency-Key': env.messageId },
        body: payload,
        timeoutMs: 20_000,
      });
    } catch (err) {
      lastError = (err as Error).message;
      continue; // network / timeout: retry
    }
    if (res.ok) return { messageId: env.messageId, providerId: res.body.id };

    const msg = res.body.message || `HTTP ${res.status}`;
    if (res.status === 429 || res.status >= 500) { lastError = msg; continue; }
    if (/not verified|verify a domain|domain.*verif/i.test(msg)) {
      throw new Error(`${msg} — verify ${env.from.split('@')[1]} at resend.com/domains and add its DKIM record in Route 53.`);
    }
    if (res.status === 401 || res.status === 403) throw new Error(`Resend rejected the API key (${msg}).`);
    throw new Error(msg);
  }
  throw new Error(`Resend unavailable after 3 attempts: ${lastError}`);
}

export async function sendEmailAction(params: SendEmailParams): Promise<SendEmailResponse> {
  const attempts: Array<{ provider: string; error: string }> = [];
  try {
    const to = parseEmailList(params.to);
    const cc = parseEmailList(params.cc);
    const bcc = parseEmailList(params.bcc);
    const toList = to.valid;
    const ccList = cc.valid.filter((a) => !toList.includes(a));
    const bccList = bcc.valid.filter((a) => !toList.includes(a) && !ccList.includes(a));

    const invalid = [...to.invalid, ...cc.invalid, ...bcc.invalid];
    if (invalid.length) {
      return { success: false, error: `Not a valid email address: ${invalid.map((x) => `"${x}"`).join(', ')}. Nothing was sent.` };
    }
    if (!params.accountId || toList.length === 0 || !params.subject?.trim() || !params.htmlBody?.trim()) {
      return { success: false, error: 'A sender, at least one valid recipient, a subject and a message are required.' };
    }

    // Refuse recipients whose domain cannot receive mail, before anything is
    // handed to a provider that would accept it and bounce it later.
    let recipientChecks: RecipientCheck[] | undefined;
    if (!params.skipRecipientCheck && process.env.RECIPIENT_CHECK !== 'off') {
      recipientChecks = await checkRecipients([...toList, ...ccList, ...bccList], await knownDomains().catch(() => []));
      const problem = describeProblems(recipientChecks);
      if (problem) return { success: false, error: `Nothing was sent. ${problem}`, recipientChecks };
    }

    const [acc] = await db
      .select()
      .from(accounts)
      .where(or(eq(accounts.id, params.accountId), eq(accounts.email_address, params.accountId.toLowerCase())))
      .limit(1);

    const from = (acc?.email_address || params.accountId).trim().toLowerCase();
    if (!EMAIL_RE.test(from)) return { success: false, error: `Unknown sending account "${params.accountId}".` };

    const domain = from.split('@')[1];
    const businessName = process.env.BUSINESS_NAME?.trim();
    const fromName = params.fromName?.trim() || acc?.display_name || (isGmail(from) ? from.split('@')[0] : businessName || from.split('@')[0]);

    // Threading headers so replies land in the same conversation for the recipient.
    const headers: Record<string, string> = { 'X-Mailer': 'AetherMail/3.0' };
    let threadId = '';
    if (params.inReplyToId) {
      const [orig] = await db
        .select({ message_id: emails.message_id, id: emails.id, thread_id: emails.thread_id })
        .from(emails)
        .where(eq(emails.id, params.inReplyToId))
        .limit(1);
      const ref = orig?.message_id || (orig?.id?.startsWith('<') ? orig.id : null);
      if (ref) {
        headers['In-Reply-To'] = ref;
        headers['References'] = orig!.thread_id && orig!.thread_id !== ref && orig!.thread_id.startsWith('<')
          ? `${orig!.thread_id} ${ref}`
          : ref;
      }
      threadId = orig?.thread_id || '';
    }

    const env: Envelope = {
      from,
      fromName,
      to: toList,
      cc: ccList,
      bcc: bccList,
      subject: params.subject.trim(),
      html: params.htmlBody,
      text: htmlToText(params.htmlBody),
      messageId: `<${crypto.randomUUID()}@${domain}>`,
      replyTo: params.replyTo && EMAIL_RE.test(params.replyTo.trim()) ? params.replyTo.trim() : undefined,
      headers,
      attachments: params.attachments ?? [],
    };

    const pass = acc ? mailboxPassword(acc.oauth_tokens) : '';
    const gmail = gmailPasswords();
    let provider = '';
    let messageId = '';
    let providerId: string | undefined;

    const attempt = async (name: string, fn: () => Promise<string | Accepted>) => {
      if (provider) return;
      try {
        const out = await fn();
        messageId = typeof out === 'string' ? out : out.messageId;
        providerId = typeof out === 'string' ? undefined : out.providerId;
        provider = name;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[send] ${name} failed:`, msg);
        attempts.push({ provider: name, error: msg });
      }
    };

    if (isGmail(from)) {
      const gpass = pass || gmail.get(from);
      if (gpass) await attempt('Gmail SMTP', () => viaSmtp(env, { host: 'smtp.gmail.com', port: 465, user: from, pass: gpass }));
      else attempts.push({ provider: 'Gmail SMTP', error: `No app password saved for ${from}` });
    } else {
      if (resendConfigured()) await attempt('Resend', () => viaResend(env));

      const own = mailboxSmtp(acc);
      if (own && pass) await attempt(`SMTP ${own.host}`, () => viaSmtp(env, { ...own, user: from, pass }));

      const relayHost = process.env.SMTP_HOST?.trim();
      if (relayHost && !(relayHost === 'smtp.resend.com' && attempts.some((a) => a.provider === 'Resend'))) {
        await attempt(`SMTP relay ${relayHost}`, () =>
          viaSmtp(env, {
            host: relayHost,
            port: Number(process.env.SMTP_PORT) || 587,
            user: process.env.SMTP_USER?.trim() || undefined,
            pass: process.env.SMTP_PASS?.trim() || process.env.RESEND_API_KEY?.trim(),
          })
        );
      }

      const relayUser = process.env.GMAIL_USER?.trim().toLowerCase();
      const relayPass = relayUser ? gmail.get(relayUser) : undefined;
      if (!provider && relayUser && relayPass && process.env.ALLOW_GMAIL_RELAY !== 'false') {
        await attempt(`Gmail relay (${relayUser}, Reply-To ${from})`, () =>
          viaSmtp(env, { host: 'smtp.gmail.com', port: 465, user: relayUser, pass: relayPass }, {
            from: `"${fromName} (${from})" <${relayUser}>`,
            replyTo: from,
          })
        );
      }
    }

    if (!provider) {
      const detail = attempts.length
        ? attempts.map((a) => `${a.provider}: ${a.error}`).join(' | ')
        : 'No sending route is configured. Set RESEND_API_KEY (business domains) or save the mailbox password.';
      return { success: false, error: `Nothing was sent. ${detail}`, attempts };
    }

    // Log the sent copy so it shows in the console immediately.
    let emailId: string | undefined;
    const trackable = provider === 'Resend' && Boolean(providerId);
    try {
      const record: NewEmail = {
        id: messageId,
        account_id: acc?.id ?? params.accountId,
        thread_id: threadId || messageId,
        subject: env.subject,
        sender: `${fromName} <${from}>`,
        body_snippet: env.text.replace(/\s+/g, ' ').slice(0, 200),
        full_body: env.html,
        category: 'work',
        ai_summary: `Sent to ${toList.join(', ')}`,
        requires_alert: false,
        is_read: true,
        received_at: new Date(),
        message_id: messageId,
        recipients: [...toList, ...ccList].join(', '),
        direction: 'outbound',
        folder: 'Sent',
        has_attachments: env.attachments.length > 0,
        transport: provider,
        provider_message_id: providerId ?? null,
        delivery_status: 'sent',
        delivery_updated_at: new Date(),
      };
      if (acc && (await storeEmail(record))) emailId = record.id;
    } catch (dbErr) {
      console.warn('[send] sent, but could not log the copy:', dbErr);
    }

    return {
      success: true,
      messageId,
      emailId,
      deliveryStatus: 'sent',
      trackable,
      dispatchedAt: new Date().toISOString(),
      provider,
      recipientChecks,
      attempts: attempts.length ? attempts : undefined,
    };
  } catch (err) {
    console.error('sendEmailAction error:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Failed to send', attempts };
  }
}
