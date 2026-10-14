import { and, desc, eq, gt, inArray, isNull, lt, notInArray, or, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { emails } from '../db/schema.ts';
import { resendApi, resendConfigured } from './resend.ts';
import { pushAlert } from './notify.ts';

/**
 * Delivery tracking for outbound mail.
 *
 * "Sent" only ever meant a transport accepted the message. Whether the
 * recipient's server took it is known later, from the provider: Resend posts
 * delivery events to the webhook when they are subscribed, and its API
 * answers per message. Both paths land here, so the console can show
 * accepted → delivered, and a bounce becomes an alert instead of silence.
 */

export type DeliveryStatus = 'sent' | 'delivery_delayed' | 'delivered' | 'bounced' | 'complained' | 'failed';

export const FINAL_STATUSES: DeliveryStatus[] = ['delivered', 'bounced', 'complained', 'failed'];
const PROBLEM_STATUSES: DeliveryStatus[] = ['bounced', 'complained', 'failed'];

// Events can arrive out of order; never let a late 'sent' overwrite 'delivered'.
const RANK: Record<DeliveryStatus, number> = { sent: 1, delivery_delayed: 2, delivered: 3, bounced: 3, failed: 3, complained: 4 };

/** Maps a Resend event name or `last_event` value to our status, or null for events we ignore. */
export function fromResendEvent(event: string): DeliveryStatus | null {
  const e = event.replace(/^email\./, '');
  switch (e) {
    case 'queued':
    case 'scheduled':
    case 'sent':
      return 'sent';
    case 'delivered':
    case 'opened': // opens and clicks imply delivery
    case 'clicked':
      return 'delivered';
    case 'delivery_delayed':
      return 'delivery_delayed';
    case 'bounced':
      return 'bounced';
    case 'complained':
      return 'complained';
    case 'failed':
    case 'canceled':
      return 'failed';
    default:
      return null;
  }
}

interface ResendBounce { message?: string; type?: string; subType?: string; diagnosticCode?: string[] | string }

export function describeBounce(b?: ResendBounce | null, failed?: { reason?: string } | null): string | null {
  if (failed?.reason) return failed.reason;
  if (!b) return null;
  const diag = Array.isArray(b.diagnosticCode) ? b.diagnosticCode.join('; ') : b.diagnosticCode;
  const kind = [b.type, b.subType].filter(Boolean).join('/');
  return [diag?.replace(/^smtp;\s*/i, ''), kind && `(${kind})`].filter(Boolean).join(' ') || b.message || null;
}

/** Applies a status to every stored copy of a provider message. Returns the rows changed. */
export async function applyDeliveryStatus(providerId: string, status: DeliveryStatus, detail?: string | null) {
  const rows = await db
    .select({ id: emails.id, status: emails.delivery_status, subject: emails.subject, recipients: emails.recipients })
    .from(emails)
    .where(eq(emails.provider_message_id, providerId));

  let changed = 0;
  for (const row of rows) {
    const prev = row.status as DeliveryStatus | null;
    if (prev === status || (prev && RANK[prev] > RANK[status])) continue;
    const problem = PROBLEM_STATUSES.includes(status);
    await db
      .update(emails)
      .set({
        delivery_status: status,
        delivery_detail: detail ?? null,
        delivery_updated_at: new Date(),
        // A bounce has to be seen: surface it as an unread alert.
        ...(problem ? { requires_alert: true, is_read: false } : {}),
      })
      .where(eq(emails.id, row.id));
    changed++;
    if (problem) {
      void pushAlert({
        subject: `Not delivered: ${row.subject}`,
        sender: 'AetherMail delivery',
        summary: `${status} — ${row.recipients ?? ''}${detail ? `: ${detail}` : ''}`,
      });
    }
  }
  return changed;
}

/** Asks Resend for the latest state of one stored message. Never throws. */
export async function refreshDelivery(emailId: string) {
  const [row] = await db
    .select({
      id: emails.id,
      provider_message_id: emails.provider_message_id,
      transport: emails.transport,
      delivery_status: emails.delivery_status,
      delivery_detail: emails.delivery_detail,
      delivery_updated_at: emails.delivery_updated_at,
    })
    .from(emails)
    .where(eq(emails.id, emailId))
    .limit(1);
  if (!row) return null;

  const pending = !row.delivery_status || !FINAL_STATUSES.includes(row.delivery_status as DeliveryStatus);
  if (pending && row.provider_message_id && row.transport === 'Resend' && resendConfigured()) {
    try {
      const r = await resendApi<{ last_event?: string; bounce?: ResendBounce; failed?: { reason?: string } }>(
        `/emails/${encodeURIComponent(row.provider_message_id)}`,
        { timeoutMs: 8000 }
      );
      const status = r.ok && r.body.last_event ? fromResendEvent(r.body.last_event) : null;
      if (status) {
        await applyDeliveryStatus(row.provider_message_id, status, describeBounce(r.body.bounce, r.body.failed));
        const [fresh] = await db
          .select({ delivery_status: emails.delivery_status, delivery_detail: emails.delivery_detail, delivery_updated_at: emails.delivery_updated_at })
          .from(emails)
          .where(eq(emails.id, emailId));
        return { ...row, ...fresh };
      }
    } catch (err) {
      console.warn('[delivery] refresh failed:', (err as Error).message);
    }
  }
  return row;
}

/**
 * Background pass, run with each sync: refreshes recent Resend sends that have
 * no final status yet, so a bounce is noticed even when nobody has the
 * message open and the webhook is not subscribed to delivery events.
 */
export async function reconcileDeliveries(opts: { limit?: number; deadline?: number } = {}) {
  if (!resendConfigured()) return { checked: 0 };
  const rows = await db
    .select({ id: emails.id })
    .from(emails)
    .where(
      and(
        eq(emails.direction, 'outbound'),
        eq(emails.transport, 'Resend'),
        sql`${emails.provider_message_id} is not null`,
        or(isNull(emails.delivery_status), notInArray(emails.delivery_status, FINAL_STATUSES)),
        gt(emails.received_at, new Date(Date.now() - 3 * 86_400_000)),
        // Leave messages alone for a minute after the last check.
        or(isNull(emails.delivery_updated_at), lt(emails.delivery_updated_at, new Date(Date.now() - 60_000)))
      )
    )
    .orderBy(desc(emails.received_at))
    .limit(opts.limit ?? 10);

  let checked = 0;
  for (const r of rows) {
    if (opts.deadline && Date.now() > opts.deadline - 2000) break;
    const before = await refreshDelivery(r.id);
    // Stamp the check even when nothing changed, so the next pass waits.
    if (before && !FINAL_STATUSES.includes(before.delivery_status as DeliveryStatus)) {
      await db.update(emails).set({ delivery_updated_at: new Date() }).where(eq(emails.id, r.id));
    }
    checked++;
  }
  return { checked };
}

/**
 * One-off link-up for mail sent before delivery tracking existed: matches
 * recent untracked Sent rows to Resend's log by subject, first recipient and
 * time, so an earlier bounce (say, a mistyped domain) shows up too.
 */
export async function backfillUntrackedSends() {
  if (!resendConfigured()) return { matched: 0 };
  const rows = await db
    .select({ id: emails.id, subject: emails.subject, recipients: emails.recipients, received_at: emails.received_at })
    .from(emails)
    .where(
      and(
        eq(emails.direction, 'outbound'),
        isNull(emails.transport),
        isNull(emails.provider_message_id),
        gt(emails.received_at, new Date(Date.now() - 14 * 86_400_000))
      )
    )
    .limit(50);
  if (!rows.length) return { matched: 0 };

  let log: Array<{ id: string; to?: string[]; subject?: string; created_at?: string; last_event?: string }> = [];
  try {
    const r = await resendApi<{ data?: typeof log }>('/emails?limit=100', { timeoutMs: 10_000 });
    if (r.ok) log = r.body.data ?? [];
  } catch (err) {
    console.warn('[delivery] backfill list failed:', (err as Error).message);
    return { matched: 0 };
  }

  let matched = 0;
  const untracked: string[] = [];
  for (const row of rows) {
    const firstRcpt = (row.recipients ?? '').split(',')[0]?.trim().toLowerCase();
    const at = row.received_at?.getTime() ?? 0;
    const hit = log.find(
      (e) =>
        e.subject === row.subject &&
        (e.to ?? []).some((t) => t.toLowerCase() === firstRcpt) &&
        e.created_at &&
        Math.abs(new Date(e.created_at.replace(' ', 'T').replace(/\+00$/, 'Z')).getTime() - at) < 5 * 60_000
    );
    if (!hit) { untracked.push(row.id); continue; }
    await db.update(emails).set({ provider_message_id: hit.id, transport: 'Resend', delivery_status: 'sent' }).where(eq(emails.id, row.id));
    const status = hit.last_event ? fromResendEvent(hit.last_event) : null;
    if (status && status !== 'sent') await refreshDelivery(row.id);
    matched++;
  }
  // Not in Resend's log (IMAP-synced Sent mail, older sends): stop looking.
  if (untracked.length) await db.update(emails).set({ transport: 'untracked' }).where(inArray(emails.id, untracked));
  return { matched };
}
