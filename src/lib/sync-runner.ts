import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { accounts, emails, type Account } from '../db/schema.ts';
import { mailboxPassword } from './secrets.ts';
import { syncMailbox, createImapClient, resolveImapProvider } from './imap-sync.ts';
import { readMailboxConfig } from './secrets.ts';
import { isAiConfigured, classifyWithAi } from './gemini.ts';

export interface AccountSyncReport {
  accountId: string;
  email: string;
  status: 'ok' | 'skipped' | 'busy' | 'no-credentials' | 'error';
  imported: number;
  error?: string;
  partial?: boolean;
}

/** Below this age a non-forced sync of an account is skipped as already fresh. */
const MIN_INTERVAL_MS = 15_000;
/** How long one run may hold an account before another instance may take over. */
const LEASE_SECONDS = 120;

/**
 * Env fallbacks for mailboxes whose password is not stored on the account row.
 * Env-only: a literal fallback leaks a live credential and hides missing config.
 */
function envPasswords(): Map<string, string> {
  const map = new Map<string, string>();
  const add = (user?: string, pass?: string) => {
    if (user?.trim() && pass?.trim()) map.set(user.trim().toLowerCase(), pass.trim());
  };
  add(process.env.GMAIL_USER, process.env.GMAIL_APP_PASSWORD);
  add(process.env.BACKUPE9_USER, process.env.BACKUPE9_APP_PASSWORD);
  add(process.env.AETHERMAIL_SENDER, process.env.IMAP_PASSWORD);
  return map;
}

export function passwordFor(acc: Account, env = envPasswords()): string {
  return mailboxPassword(acc.oauth_tokens) || env.get(acc.email_address.trim().toLowerCase()) || '';
}

async function routingMap(): Promise<Map<string, string>> {
  const rows = await db.select({ id: accounts.id, email: accounts.email_address }).from(accounts);
  return new Map(rows.map((r) => [r.email.trim().toLowerCase(), r.id]));
}

/**
 * Takes the account's lease. The lease lives in the database, so it holds
 * across serverless instances, browser tabs and the cron job at once — the old
 * in-memory flag only covered a single process.
 */
async function acquireLease(accountId: string, force: boolean): Promise<'ok' | 'busy' | 'fresh'> {
  const res = await db.execute(sql`
    UPDATE accounts
       SET sync_lease_until = now() + (${LEASE_SECONDS} * interval '1 second'), sync_status = 'syncing'
     WHERE id = ${accountId}
       AND (sync_lease_until IS NULL OR sync_lease_until < now())
       AND (${force} OR last_synced_at IS NULL OR last_synced_at < now() - (${MIN_INTERVAL_MS} * interval '1 millisecond'))
     RETURNING id`);
  if (res.rows.length > 0) return 'ok';

  const [row] = await db
    .select({ lease: accounts.sync_lease_until })
    .from(accounts)
    .where(eq(accounts.id, accountId));
  return row?.lease && row.lease > new Date() ? 'busy' : 'fresh';
}

export async function syncOneAccount(
  acc: Account,
  opts: { force?: boolean; deadline?: number; routing?: Map<string, string>; env?: Map<string, string> } = {}
): Promise<AccountSyncReport> {
  const base = { accountId: acc.id, email: acc.email_address };
  const password = passwordFor(acc, opts.env);

  // Mailboxes that receive through the Resend webhook have nothing to poll.
  if (!password && acc.provider === 'resend') {
    if (acc.last_sync_error || acc.sync_status !== 'synced') {
      await db.update(accounts).set({ sync_status: 'synced', last_sync_error: null }).where(eq(accounts.id, acc.id));
    }
    return { ...base, status: 'skipped', imported: 0 };
  }

  if (!password) {
    await db
      .update(accounts)
      .set({ sync_status: 'error', last_sync_error: 'No mailbox password saved. Reconnect this mailbox to resume syncing.' })
      .where(eq(accounts.id, acc.id));
    return { ...base, status: 'no-credentials', imported: 0, error: 'No mailbox password saved' };
  }

  const lease = await acquireLease(acc.id, Boolean(opts.force));
  if (lease !== 'ok') return { ...base, status: lease === 'busy' ? 'busy' : 'skipped', imported: 0 };

  let result;
  try {
    result = await syncMailbox(acc, password, {
      deadline: opts.deadline,
      routing: opts.routing ?? (await routingMap()),
    });
  } catch (err) {
    result = { success: false, imported: 0, error: (err as Error).message };
  }

  await db
    .update(accounts)
    .set({
      sync_status: result.success ? 'synced' : 'error',
      last_sync_error: result.success ? null : result.error ?? 'Unknown sync error',
      last_synced_at: result.success ? new Date() : acc.last_synced_at,
      sync_lease_until: null,
    })
    .where(eq(accounts.id, acc.id));

  if (result.newIds?.length) {
    await refineWithAi(result.newIds, opts.deadline);
  }

  return {
    ...base,
    status: result.success ? 'ok' : 'error',
    imported: result.imported,
    error: result.error,
    partial: result.partial,
  };
}

/**
 * Syncs every account in parallel. Accounts are independent, so one slow or
 * broken mailbox no longer holds the others back as the old sequential loop did.
 */
export async function syncAllAccounts(opts: { force?: boolean; budgetMs?: number } = {}) {
  const started = Date.now();
  const deadline = started + (opts.budgetMs ?? 45_000);
  const all = await db.select().from(accounts);
  const routing = new Map(all.map((a) => [a.email_address.trim().toLowerCase(), a.id]));
  const env = envPasswords();

  const reports = await mapLimit(all, 4, (acc) =>
    syncOneAccount(acc, { force: opts.force, deadline, routing, env }).catch(
      (err): AccountSyncReport => ({ accountId: acc.id, email: acc.email_address, status: 'error', imported: 0, error: (err as Error).message })
    )
  );

  return {
    success: true,
    imported: reports.reduce((n, r) => n + r.imported, 0),
    reports,
    durationMs: Date.now() - started,
    syncedAt: new Date().toISOString(),
  };
}

/** Replaces keyword categories with a model's verdict, within the time left. */
async function refineWithAi(ids: string[], deadline?: number) {
  if (!isAiConfigured()) return;
  const cap = Number(process.env.AI_CLASSIFY_PER_SYNC) || 8;
  const rows = await db
    .select({ id: emails.id, subject: emails.subject, sender: emails.sender, body: emails.body_snippet, full: emails.full_body, category: emails.category })
    .from(emails)
    .where(inArray(emails.id, ids.slice(-cap)));

  await mapLimit(rows, 3, async (row) => {
    if (row.category === 'spam') return;
    if (deadline && Date.now() > deadline - 3000) return;
    try {
      const text = row.full.replace(/<style[\s\S]*?<\/style>|<[^>]+>/gi, ' ').replace(/\s+/g, ' ').slice(0, 6000);
      const ai = await classifyWithAi({ subject: row.subject, sender: row.sender, body: text || row.body });
      if (!ai) return;
      await db
        .update(emails)
        .set({ category: ai.category, ai_summary: ai.summary, requires_alert: ai.requires_alert })
        .where(eq(emails.id, row.id));
    } catch (err) {
      console.warn('[sync] AI refinement skipped:', (err as Error).message);
    }
  });
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

// ---------------------------------------------------------------------------
// Long-running mode (laptop / VPS / `npm start`): IMAP IDLE push
// ---------------------------------------------------------------------------

/**
 * Keeps an IDLE connection open on each mailbox's INBOX, so new mail is pulled
 * within seconds of arriving instead of on the next poll. A periodic full sync
 * runs underneath as a safety net for anything IDLE misses (dropped
 * connections, Spam and Sent folders). Serverless deployments cannot hold a
 * connection open and rely on the cron + client polling instead.
 */
export function startBackgroundSync() {
  const intervalMs = (Number(process.env.SYNC_INTERVAL_SECONDS) || 60) * 1000;
  const watchers = new Map<string, { stop: () => void }>();

  const tick = async () => {
    try {
      const res = await syncAllAccounts({ budgetMs: Math.max(20_000, intervalMs - 5_000) });
      if (res.imported > 0) console.log(`[sync] imported ${res.imported} message(s) in ${res.durationMs}ms`);
      await refreshWatchers();
    } catch (err) {
      console.warn('[sync] background sync failed:', (err as Error).message);
    }
  };

  const refreshWatchers = async () => {
    if (process.env.IMAP_IDLE === 'false') return;
    const all = await db.select().from(accounts);
    const env = envPasswords();
    for (const acc of all) {
      if (watchers.has(acc.id)) continue;
      const password = passwordFor(acc, env);
      if (!password) continue;
      watchers.set(acc.id, watchInbox(acc, password));
    }
    for (const [id, w] of watchers) {
      if (!all.some((a) => a.id === id)) { w.stop(); watchers.delete(id); }
    }
  };

  void tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  console.log(`[sync] background sync every ${intervalMs / 1000}s with IMAP IDLE push`);
}

function watchInbox(acc: Account, password: string) {
  let stopped = false;
  let client: ReturnType<typeof createImapClient> | null = null;
  let debounce: NodeJS.Timeout | null = null;
  let backoff = 5_000;

  const trigger = () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(async () => {
      const [fresh] = await db.select().from(accounts).where(eq(accounts.id, acc.id));
      if (fresh) {
        const r = await syncOneAccount(fresh, { force: true }).catch(() => null);
        if (r?.imported) console.log(`[idle] ${acc.email_address}: +${r.imported}`);
      }
    }, 1500);
  };

  const connect = async () => {
    if (stopped) return;
    try {
      const target = resolveImapProvider(acc.email_address, readMailboxConfig(acc.oauth_tokens));
      client = createImapClient(acc.email_address, password, target);
      client.on('exists', trigger);
      client.on('error', () => { /* 'close' handles reconnect */ });
      client.on('close', () => {
        if (!stopped) setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 5 * 60_000);
      });
      await client.connect();
      await client.mailboxOpen('INBOX', { readOnly: true });
      backoff = 5_000;
      // imapflow enters IDLE automatically once the connection is quiet.
    } catch (err) {
      console.warn(`[idle] ${acc.email_address}: ${(err as Error).message}`);
      try { client?.close(); } catch { /* ignore */ }
    }
  };

  void connect();
  return {
    stop: () => {
      stopped = true;
      if (debounce) clearTimeout(debounce);
      try { client?.close(); } catch { /* ignore */ }
    },
  };
}
