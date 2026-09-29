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
 * Success is only reported when a transport accepted the message. Every
 * attempt's failure is kept and returned, so "nothing was sent" always comes
 * with the reason each route refused.
 */

import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { eq, or } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { accounts, emails, type Account, type NewEmail } from '../../db/schema.ts';
import { mailboxPassword, readMailboxConfig } from '../../lib/secrets.ts';
import { storeEmail } from '../../lib/store-email.ts';

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
  attachments?: SendAttachment[];
  fromName?: string;
}

export interface SendEmailResponse {
  success: boolean;
  messageId?: string;
  dispatchedAt?: string;
  provider?: string;
  error?: string;
  attempts?: Array<{ provider: string; error: string }>;
}

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

const cleanEmailList = (raw?: string | string[]): string[] => {
  if (!raw) return [];
  const parts = Array.isArray(raw) ? raw : raw.split(/[,;\n]+/);
  return parts
    .map((r) => {
      const t = r.trim();
      const angle = t.match(/<([^>]+)>/);
      return (angle ? angle[1] : t).trim();
    })
    .filter((r) => EMAIL_RE.test(r));
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

const resendBase = () => (process.env.RESEND_API_URL?.trim() || 'https://api.resend.com').replace(/\/$/, '');

async function viaResend(env: Envelope): Promise<string> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) throw new Error('RESEND_API_KEY not set');

  const res = await fetch(`${resendBase()}/emails`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': env.messageId,
    },
    body: JSON.stringify({
      from: `${env.fromName} <${env.from}>`,
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
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
  if (!res.ok) {
    const msg = body.message || `HTTP ${res.status}`;
    if (/not verified|verify a domain|domain.*verif/i.test(msg)) {
      throw new Error(`${msg} — verify ${env.from.split('@')[1]} at resend.com/domains and add its DKIM record in Route 53.`);
    }
    if (res.status === 401 || res.status === 403) throw new Error(`Resend rejected the API key (${msg}).`);
    throw new Error(msg);
  }
  return env.messageId;
}

export async function sendEmailAction(params: SendEmailParams): Promise<SendEmailResponse> {
  const attempts: Array<{ provider: string; error: string }> = [];
  try {
    const toList = cleanEmailList(params.to);
    const ccList = cleanEmailList(params.cc);
    const bccList = cleanEmailList(params.bcc);

    if (!params.accountId || toList.length === 0 || !params.subject?.trim() || !params.htmlBody?.trim()) {
      return { success: false, error: 'A sender, at least one valid recipient, a subject and a message are required.' };
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
      headers,
      attachments: params.attachments ?? [],
    };

    const pass = acc ? mailboxPassword(acc.oauth_tokens) : '';
    const gmail = gmailPasswords();
    let provider = '';
    let messageId = '';

    const attempt = async (name: string, fn: () => Promise<string>) => {
      if (provider) return;
      try {
        messageId = await fn();
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
      if (process.env.RESEND_API_KEY?.trim()) await attempt('Resend', () => viaResend(env));

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
      };
      if (acc) await storeEmail(record);
    } catch (dbErr) {
      console.warn('[send] sent, but could not log the copy:', dbErr);
    }

    return {
      success: true,
      messageId,
      dispatchedAt: new Date().toISOString(),
      provider,
      attempts: attempts.length ? attempts : undefined,
    };
  } catch (err) {
    console.error('sendEmailAction error:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Failed to send', attempts };
  }
}
