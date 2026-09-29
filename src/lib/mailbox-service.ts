import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { accounts, type Account } from '../db/schema.ts';
import { encryptSecret, readMailboxConfig, type MailboxConfig } from './secrets.ts';
import { testImapLogin, resolveImapProvider } from './imap-sync.ts';
import { syncOneAccount } from './sync-runner.ts';

export interface ConnectMailboxInput {
  email_address: string;
  password: string;
  display_name?: string;
  imap_host?: string;
  imap_port?: number;
  smtp_host?: string;
  smtp_port?: number;
  /** Run the first sync before returning (default true). */
  initialSync?: boolean;
}

/**
 * Verifies a mailbox login, then saves the account with its password sealed.
 *
 * The old flow synced once with the password and threw it away, so every sync
 * after the first reported "no credentials" and the mailbox silently stopped
 * updating. The login is tested first so a typo is reported here, not as a
 * sync error an hour later.
 */
export async function connectMailbox(input: ConnectMailboxInput) {
  const email = input.email_address.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
  const password = input.password.replace(/\s+/g, '');
  if (!password) throw new Error('A mailbox password (app password) is required.');

  const [existing] = await db.select().from(accounts).where(eq(accounts.email_address, email)).limit(1);
  const prevCfg = existing ? readMailboxConfig(existing.oauth_tokens) : {};

  const cfg: MailboxConfig = {
    ...(input.imap_host?.trim() ? { imap_host: input.imap_host.trim(), imap_port: Number(input.imap_port) || 993 } : {
      imap_host: prevCfg.imap_host,
      imap_port: prevCfg.imap_port,
    }),
    ...(input.smtp_host?.trim() ? { smtp_host: input.smtp_host.trim(), smtp_port: Number(input.smtp_port) || 465 } : {
      smtp_host: prevCfg.smtp_host,
      smtp_port: prevCfg.smtp_port,
    }),
  };

  const probe = await testImapLogin(email, password, cfg);
  if (!probe.ok) throw new Error(`${probe.host}: ${probe.error}`);

  const target = resolveImapProvider(email, cfg);
  const sealed: MailboxConfig = { ...cfg, imap_host: cfg.imap_host || target.host, imap_port: cfg.imap_port || target.port, secret: encryptSecret(password) };

  let account: Account;
  if (existing) {
    [account] = await db
      .update(accounts)
      .set({
        oauth_tokens: sealed,
        provider: target.provider,
        display_name: input.display_name?.trim() || existing.display_name,
        sync_status: 'synced',
        last_sync_error: null,
      })
      .where(eq(accounts.id, existing.id))
      .returning();
  } else {
    [account] = await db
      .insert(accounts)
      .values({
        id: `acc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        provider: target.provider,
        email_address: email,
        oauth_tokens: sealed,
        display_name: input.display_name?.trim() || null,
        sync_status: 'synced',
      })
      .returning();
  }

  const report = input.initialSync === false
    ? null
    : await syncOneAccount(account, { force: true, deadline: Date.now() + 40_000 });

  return { account, folders: probe.folders, report };
}
