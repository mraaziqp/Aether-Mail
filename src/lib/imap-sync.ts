import { ImapFlow, type ListResponse } from 'imapflow';
import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { emails, sync_state, type Account, type NewEmail } from '../db/schema.ts';
import { heuristicClassify } from './classify.ts';
import { readMailboxConfig, type MailboxConfig } from './secrets.ts';
import { pushAlert } from './notify.ts';
import { storeEmail } from './store-email.ts';

export interface ImapSyncResult {
  success: boolean;
  imported: number;
  error?: string;
  /** Ids of inbound messages inserted by this run, newest last. */
  newIds?: string[];
  /** True when the run stopped at its deadline with work still queued. */
  partial?: boolean;
}

export interface ImapProvider {
  host: string;
  port: number;
  provider: string;
  /** Junk folder name when the server does not advertise SPECIAL-USE. */
  spamFolder: string;
}

const PROVIDERS: Record<string, ImapProvider> = {
  'gmail.com':      { host: 'imap.gmail.com',        port: 993, provider: 'google',    spamFolder: '[Gmail]/Spam' },
  'googlemail.com': { host: 'imap.gmail.com',        port: 993, provider: 'google',    spamFolder: '[Gmail]/Spam' },
  'zoho.com':       { host: 'imap.zoho.com',         port: 993, provider: 'zoho',      spamFolder: 'Spam' },
  'zohomail.com':   { host: 'imap.zoho.com',         port: 993, provider: 'zoho',      spamFolder: 'Spam' },
  'outlook.com':    { host: 'outlook.office365.com', port: 993, provider: 'microsoft', spamFolder: 'Junk Email' },
  'hotmail.com':    { host: 'outlook.office365.com', port: 993, provider: 'microsoft', spamFolder: 'Junk Email' },
  'live.com':       { host: 'outlook.office365.com', port: 993, provider: 'microsoft', spamFolder: 'Junk Email' },
};

/**
 * Work out which IMAP server holds a given address.
 *
 * Order: the host saved on the account itself, then a known consumer domain,
 * then IMAP_HOST from the environment. Business domains are the interesting
 * case: contact@arpcloudsolutions.co.za says nothing about where the mailbox
 * lives, so it needs either a per-account host or IMAP_HOST.
 *
 * An unknown domain throws rather than falling back to Gmail. A silent Gmail
 * default turns "this domain is not configured" into "authentication failed",
 * which sends you hunting for a password problem that does not exist.
 */
export function resolveImapProvider(emailAddress: string, cfg: MailboxConfig = {}): ImapProvider {
  const domain = emailAddress.split('@')[1]?.toLowerCase() ?? '';
  const known = PROVIDERS[domain];

  if (cfg.imap_host) {
    return {
      host: cfg.imap_host,
      port: cfg.imap_port || 993,
      provider: known?.provider || (cfg.imap_host.includes('zoho') ? 'zoho' : 'imap'),
      spamFolder: cfg.spam_folder || known?.spamFolder || 'Spam',
    };
  }
  if (known) return known;

  const host = process.env.IMAP_HOST?.trim();
  if (!host) {
    throw new Error(
      `No IMAP server known for "${domain}". Save the IMAP host on the account ` +
      `(Connect mailbox → Server) or set IMAP_HOST — e.g. imappro.zoho.com for a custom domain on Zoho Mail.`
    );
  }
  return {
    host,
    port: Number(process.env.IMAP_PORT) || 993,
    provider: process.env.IMAP_PROVIDER?.trim() || 'imap',
    spamFolder: process.env.IMAP_SPAM_FOLDER?.trim() || 'Spam',
  };
}

export function createImapClient(emailAddress: string, password: string, target: ImapProvider) {
  // Certificate verification stays on. IMAP_ALLOW_SELF_SIGNED exists for a
  // local server with its own CA and is opt-in per deployment.
  const allowSelfSigned = process.env.IMAP_ALLOW_SELF_SIGNED === 'true';
  return new ImapFlow({
    host: target.host,
    port: target.port,
    secure: target.port !== 143,
    auth: { user: emailAddress.trim().toLowerCase(), pass: password.replace(/\s+/g, '') },
    logger: false,
    tls: { rejectUnauthorized: !allowSelfSigned },
    clientInfo: { name: 'AetherMail', version: '3.0' },
    connectionTimeout: 12000,
    greetingTimeout: 8000,
    socketTimeout: 60000,
  });
}

async function closeQuietly(client: ImapFlow) {
  try {
    if (client.usable) await client.logout();
    else client.close();
  } catch {
    try { client.close(); } catch { /* already gone */ }
  }
}

/** Logs in and lists folders, without importing anything. Used before saving an account. */
export async function testImapLogin(emailAddress: string, password: string, cfg: MailboxConfig = {}) {
  const target = resolveImapProvider(emailAddress, cfg);
  const client = createImapClient(emailAddress, password, target);
  try {
    await client.connect();
    const boxes = await client.list();
    return { ok: true as const, host: target.host, folders: boxes.map((b) => b.path) };
  } catch (err) {
    return { ok: false as const, host: target.host, error: describeImapError(err) };
  } finally {
    await closeQuietly(client);
  }
}

/** Turns imapflow's terse failures into something that says what to fix. */
export function describeImapError(err: unknown): string {
  const e = err as { message?: string; authenticationFailed?: boolean; responseText?: string; code?: string };
  if (e?.authenticationFailed) {
    return `Login rejected by the mail server${e.responseText ? ` (${e.responseText})` : ''}. ` +
      'Use an app-specific password (Gmail and Zoho both require one when 2FA is on), and check IMAP access is enabled for the mailbox.';
  }
  if (e?.code === 'ENOTFOUND') return `Mail server host not found (${e.message}). Check the IMAP host.`;
  if (e?.code === 'ETIMEDOUT' || e?.code === 'ECONNREFUSED') return `Could not reach the mail server (${e.code}). Check host and port 993.`;
  return e?.responseText || e?.message || String(err);
}

type FolderKind = 'inbox' | 'spam' | 'sent';

function pickFolders(boxes: ListResponse[], target: ImapProvider): Array<{ path: string; kind: FolderKind }> {
  const out: Array<{ path: string; kind: FolderKind }> = [{ path: 'INBOX', kind: 'inbox' }];
  const bySpecial = (flag: string) => boxes.find((b) => b.specialUse === flag)?.path;
  const byName = (name: string) => boxes.find((b) => b.path.toLowerCase() === name.toLowerCase())?.path;

  const junk = bySpecial('\\Junk') || byName(target.spamFolder) || byName('Spam') || byName('Junk');
  if (junk) out.push({ path: junk, kind: 'spam' });

  if (process.env.IMAP_SYNC_SENT !== 'false') {
    const sent = bySpecial('\\Sent') || byName('Sent') || byName('Sent Items') || byName('[Gmail]/Sent Mail');
    if (sent) out.push({ path: sent, kind: 'sent' });
  }
  return out;
}

const addressList = (field?: AddressObject | AddressObject[]): string[] => {
  if (!field) return [];
  const list = Array.isArray(field) ? field : [field];
  return list.flatMap((a) => a.value.map((v) => v.address?.toLowerCase()).filter((x): x is string => !!x));
};

const headerText = (parsed: ParsedMail, name: string): string => {
  const v = parsed.headers.get(name);
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.join(' ');
  if (typeof v === 'object' && 'text' in (v as object)) return String((v as { text: string }).text);
  return String(v);
};

const MAX_BODY_CHARS = 1_000_000;
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;

export interface SyncOptions {
  /** Epoch ms after which the run stops cleanly and saves its position. */
  deadline?: number;
  /** How many recent messages to import the first time a folder is seen. */
  backfill?: number;
  /** Lowercased address → account id, so forwarded mail lands in the right mailbox. */
  routing?: Map<string, string>;
}

/**
 * Incremental sync of one mailbox.
 *
 * Tracks the last imported UID per folder (sync_state). A run with nothing new
 * costs a STATUS per folder and no downloads, which is what makes a short
 * polling interval affordable. A UIDVALIDITY change (the server renumbered the
 * folder) resets that folder to a fresh backfill; message ids dedupe the rest.
 */
export async function syncMailbox(account: Account, password: string, opts: SyncOptions = {}): Promise<ImapSyncResult> {
  const deadline = opts.deadline ?? Date.now() + 45_000;
  const backfill = opts.backfill ?? (Number(process.env.IMAP_BACKFILL) || 50);
  const cfg = readMailboxConfig(account.oauth_tokens);
  const selfAddress = account.email_address.trim().toLowerCase();

  let target: ImapProvider;
  try {
    target = resolveImapProvider(selfAddress, cfg);
  } catch (err) {
    return { success: false, imported: 0, error: (err as Error).message };
  }

  const client = createImapClient(selfAddress, password, target);
  client.on('error', (err) => console.warn(`[IMAP ${selfAddress}] connection error:`, err?.message));

  let imported = 0;
  const newIds: string[] = [];
  let partial = false;

  try {
    await client.connect();

    const boxes = await client.list();
    const folders = pickFolders(boxes, target);
    const states = new Map(
      (await db.select().from(sync_state).where(eq(sync_state.account_id, account.id))).map((s) => [s.folder, s])
    );

    for (const folder of folders) {
      if (Date.now() > deadline) { partial = true; break; }

      let status;
      try {
        status = await client.status(folder.path, { messages: true, uidNext: true, uidValidity: true });
      } catch {
        continue; // folder vanished between LIST and STATUS
      }
      const validity = Number(status.uidValidity ?? 0);
      const uidNext = status.uidNext ?? 0;
      const total = status.messages ?? 0;
      const prev = states.get(folder.path);
      const fresh = !prev || prev.uid_validity !== validity;

      if (!fresh && uidNext > 0 && uidNext - 1 <= prev!.last_uid) continue; // nothing new: the common case

      const saveState = async (lastUid: number) => {
        await db
          .insert(sync_state)
          .values({ account_id: account.id, folder: folder.path, uid_validity: validity, last_uid: lastUid, updated_at: new Date() })
          .onConflictDoUpdate({
            target: [sync_state.account_id, sync_state.folder],
            set: { uid_validity: validity, last_uid: lastUid, updated_at: new Date() },
          });
      };

      if (total === 0) {
        await saveState(Math.max(0, uidNext - 1));
        continue;
      }

      const lock = await client.getMailboxLock(folder.path, { readOnly: true });
      try {
        // Phase 1: cheap metadata to decide what is new.
        const wantBackfill = folder.kind === 'inbox' ? backfill : Math.min(20, backfill);
        const metas = fresh
          ? await client.fetchAll(`${Math.max(1, total - wantBackfill + 1)}:*`, { uid: true, flags: true, size: true })
          : await client.fetchAll(`${prev!.last_uid + 1}:*`, { uid: true, flags: true, size: true }, { uid: true });

        const floor = fresh ? 0 : prev!.last_uid;
        const pending = metas.filter((m) => m.uid > floor).sort((a, b) => a.uid - b.uid);
        let lastUid = floor;

        // Phase 2: full source in small batches, checkpointing as we go so a
        // run cut short by a serverless timeout never repeats finished work.
        for (let i = 0; i < pending.length; i += 20) {
          if (Date.now() > deadline) { partial = true; break; }
          const batch = pending.slice(i, i + 20);
          const full = await client.fetchAll(
            batch.map((m) => m.uid).join(','),
            { uid: true, flags: true, source: { maxLength: MAX_SOURCE_BYTES }, internalDate: true },
            { uid: true }
          );
          full.sort((a, b) => a.uid - b.uid);

          for (const msg of full) {
            if (!msg.source) { lastUid = Math.max(lastUid, msg.uid); continue; }
            try {
              const rec = await buildRecord({
                account, selfAddress, folder, validity, uid: msg.uid,
                source: msg.source, flags: msg.flags, internalDate: msg.internalDate,
                routing: opts.routing,
              });
              if (await storeEmail(rec)) {
                imported++;
                if (rec.direction === 'inbound') newIds.push(rec.id);
                // A first-time backfill of 50 old messages must not fire 50 phone alerts.
                if (!fresh && rec.requires_alert && !rec.is_read && rec.direction === 'inbound') {
                  void pushAlert({ subject: rec.subject, sender: rec.sender, summary: rec.ai_summary, account: selfAddress });
                }
              }
            } catch (msgErr) {
              console.warn(`[IMAP ${selfAddress}] skipped uid ${msg.uid} in ${folder.path}:`, (msgErr as Error).message);
            }
            lastUid = Math.max(lastUid, msg.uid);
          }
          await saveState(lastUid);
        }

        if (!partial && pending.length === 0) await saveState(Math.max(floor, uidNext - 1));
      } finally {
        lock.release();
      }
    }

    return { success: true, imported, newIds, partial };
  } catch (err) {
    const message = describeImapError(err);
    console.error(`[IMAP ${selfAddress}] sync failed:`, message);
    return { success: false, imported, newIds, error: message };
  } finally {
    await closeQuietly(client);
  }
}

async function buildRecord(input: {
  account: Account;
  selfAddress: string;
  folder: { path: string; kind: FolderKind };
  validity: number;
  uid: number;
  source: Buffer;
  flags?: Set<string>;
  internalDate?: Date | string;
  routing?: Map<string, string>;
}): Promise<NewEmail> {
  const parsed = await simpleParser(input.source, { skipImageLinks: true });

  const messageId = parsed.messageId?.trim() || null;
  const id = messageId || `imap:${input.account.id}:${input.folder.path}:${input.validity}:${input.uid}`;

  const fromAddrs = addressList(parsed.from);
  const toAddrs = addressList(parsed.to);
  const ccAddrs = addressList(parsed.cc);
  const envelopeRcpts = ['delivered-to', 'x-original-to', 'x-forwarded-to', 'envelope-to']
    .map((h) => headerText(parsed, h).toLowerCase())
    .join(' ')
    .match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ?? [];

  const outbound = input.folder.kind === 'sent' || fromAddrs.includes(input.selfAddress);

  // Mail forwarded into this mailbox for another connected address (say a
  // Gmail inbox receiving forwards for contact@) belongs to that account.
  let accountId = input.account.id;
  const addressedHere = [...envelopeRcpts, ...toAddrs, ...ccAddrs].includes(input.selfAddress);
  if (!outbound && !addressedHere && input.routing) {
    for (const addr of [...envelopeRcpts, ...toAddrs, ...ccAddrs]) {
      const target = input.routing.get(addr);
      if (target && target !== input.account.id) { accountId = target; break; }
    }
  }

  const subject = parsed.subject?.trim() || '(No Subject)';
  const sender = parsed.from?.text || input.selfAddress;
  const text = parsed.text || (typeof parsed.html === 'string' ? parsed.html.replace(/<style[\s\S]*?<\/style>|<[^>]+>/gi, ' ') : '');
  const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 200);
  const html = typeof parsed.html === 'string' && parsed.html ? parsed.html : parsed.textAsHtml || text;
  const cls = heuristicClassify({ subject, sender, text, folderKind: input.folder.kind });

  const refs = Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : [];
  const threadRoot = refs[0] || parsed.inReplyTo || messageId || id;

  const received = parsed.date && !isNaN(parsed.date.getTime())
    ? parsed.date
    : input.internalDate ? new Date(input.internalDate) : new Date();

  return {
    id,
    account_id: accountId,
    thread_id: threadRoot,
    subject,
    sender,
    body_snippet: snippet,
    full_body: html.length > MAX_BODY_CHARS ? html.slice(0, MAX_BODY_CHARS) : html,
    category: outbound ? 'work' : cls.category,
    ai_summary: snippet.slice(0, 160) || `Message from ${sender}: ${subject}`,
    requires_alert: outbound ? false : cls.requires_alert,
    is_read: outbound || Boolean(input.flags?.has('\\Seen')),
    received_at: received,
    message_id: messageId,
    recipients: [...toAddrs, ...ccAddrs].join(', ') || null,
    direction: outbound ? 'outbound' : 'inbound',
    folder: input.folder.path,
    has_attachments: parsed.attachments.some((a) => a.contentDisposition !== 'inline'),
  };
}

/** Forget a folder's position so the next run backfills it again. */
export async function resetSyncState(accountId: string, folder?: string) {
  await db
    .delete(sync_state)
    .where(folder ? and(eq(sync_state.account_id, accountId), eq(sync_state.folder, folder)) : eq(sync_state.account_id, accountId));
}
