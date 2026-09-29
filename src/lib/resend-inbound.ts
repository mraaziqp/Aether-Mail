import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { accounts, type NewEmail } from '../db/schema.ts';
import { heuristicClassify } from './classify.ts';
import { pushAlert } from './notify.ts';
import { storeEmail } from './store-email.ts';
import { businessDomain } from './business-mailboxes.ts';

/**
 * Resend inbound mail (optional ingestion route).
 *
 * If the domain's MX points at Resend's inbound servers, Resend POSTs an
 * `email.received` webhook for every message. That makes delivery into
 * AetherMail push-based — no polling at all — and Resend keeps the message, so
 * a missed webhook is retried and can be re-fetched.
 *
 * The primary plan is still Zoho as MX with IMAP sync (see BUSINESS-MAIL.md).
 * Use this route instead when you want AetherMail itself to be the inbox.
 */

/** Verifies a Svix-signed webhook (the scheme Resend uses). */
export function verifySvixSignature(rawBody: string, headers: Record<string, string | string[] | undefined>, secret: string): boolean {
  const id = String(headers['svix-id'] ?? '');
  const ts = String(headers['svix-timestamp'] ?? '');
  const sigHeader = String(headers['svix-signature'] ?? '');
  if (!id || !ts || !sigHeader) return false;

  // Reject replays older than five minutes.
  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(age) || age > 300) return false;

  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
  const expected = crypto.createHmac('sha256', key).update(`${id}.${ts}.${rawBody}`).digest('base64');

  return sigHeader.split(' ').some((part) => {
    const [, sig] = part.split(',');
    if (!sig) return false;
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

interface ReceivedEmail {
  id?: string;
  email_id?: string;
  from?: string;
  to?: string[] | string;
  cc?: string[] | string;
  subject?: string;
  html?: string | null;
  text?: string | null;
  message_id?: string;
  created_at?: string;
  attachments?: unknown[];
}

const toArray = (v?: string[] | string) => (Array.isArray(v) ? v : v ? [v] : []);
const bareAddress = (s: string) => (s.match(/<([^>]+)>/)?.[1] ?? s).trim().toLowerCase();

async function fetchReceived(emailId: string): Promise<ReceivedEmail | null> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return null;
  try {
    const base = (process.env.RESEND_API_URL?.trim() || 'https://api.resend.com').replace(/\/$/, '');
    const res = await fetch(`${base}/emails/receiving/${encodeURIComponent(emailId)}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.warn(`[resend-inbound] fetch ${emailId} → HTTP ${res.status} (a send-only API key cannot read received mail)`);
      return null;
    }
    return (await res.json()) as ReceivedEmail;
  } catch (err) {
    console.warn('[resend-inbound] fetch failed:', (err as Error).message);
    return null;
  }
}

export async function ingestResendEvent(event: { type?: string; data?: ReceivedEmail }) {
  if (event.type !== 'email.received' || !event.data) return { stored: 0, ignored: event.type ?? 'unknown' };

  const meta = event.data;
  const resendId = meta.email_id || meta.id || '';
  const full = (meta.html || meta.text ? meta : null) ?? (resendId ? await fetchReceived(resendId) : null);
  const msg: ReceivedEmail = { ...meta, ...(full ?? {}) };

  const recipients = [...toArray(msg.to), ...toArray(msg.cc)].map(bareAddress);
  const domain = businessDomain();

  // Every address on the business domain gets its own mailbox row, so a
  // catch-all MX captures mail to any address, not only pre-registered ones.
  let stored = 0;
  const targets = recipients.filter((r) => !domain || r.endsWith(`@${domain}`));
  for (const rcpt of targets.length ? targets : recipients.slice(0, 1)) {
    let [acc] = await db.select().from(accounts).where(eq(accounts.email_address, rcpt)).limit(1);
    if (!acc) {
      [acc] = await db
        .insert(accounts)
        .values({ id: `acc_rs_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, provider: 'resend', email_address: rcpt, sync_status: 'synced' })
        .onConflictDoNothing()
        .returning();
      if (!acc) [acc] = await db.select().from(accounts).where(eq(accounts.email_address, rcpt)).limit(1);
    }

    const sender = msg.from || 'unknown sender';
    const subject = msg.subject?.trim() || '(No Subject)';
    const text = msg.text || (msg.html ? msg.html.replace(/<style[\s\S]*?<\/style>|<[^>]+>/gi, ' ') : '');
    const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 200);
    const cls = heuristicClassify({ subject, sender, text });
    const id = msg.message_id || `resend:${resendId}`;

    const row: NewEmail = {
      id,
      account_id: acc.id,
      thread_id: msg.message_id || id,
      subject,
      sender,
      body_snippet: snippet,
      full_body: msg.html || (text ? `<pre style="white-space:pre-wrap;font-family:inherit">${text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)}</pre>` : (full ? '' : '<p><em>Body not retrieved: set a RESEND_API_KEY with full access so AetherMail can fetch received mail.</em></p>')),
      category: cls.category,
      ai_summary: snippet.slice(0, 160) || subject,
      requires_alert: cls.requires_alert,
      is_read: false,
      received_at: msg.created_at ? new Date(msg.created_at) : new Date(),
      message_id: msg.message_id ?? null,
      recipients: recipients.join(', '),
      direction: 'inbound',
      folder: 'INBOX',
      has_attachments: Array.isArray(msg.attachments) && msg.attachments.length > 0,
    };

    if (await storeEmail(row)) {
      stored++;
      if (row.requires_alert) void pushAlert({ subject, sender, summary: row.ai_summary, account: rcpt });
    }
  }
  return { stored };
}
