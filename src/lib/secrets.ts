import crypto from 'node:crypto';

/**
 * Encryption for mailbox credentials stored on account rows.
 *
 * Mailbox passwords have to live somewhere the sync can read them, and the
 * database is the only place that survives serverless cold starts. They are
 * sealed with AES-256-GCM under APP_SECRET, so a leaked database dump or a
 * Drizzle Studio screenshot does not hand out working IMAP logins.
 *
 * There is no default key. Without APP_SECRET, storing a credential fails with
 * a message saying so, rather than quietly writing something reversible.
 */

const PREFIX = 'enc:v1:';

function key(): Buffer {
  const secret = process.env.APP_SECRET?.trim();
  if (!secret) {
    throw new Error(
      'APP_SECRET is not set. It encrypts stored mailbox passwords — generate one with ' +
        '`openssl rand -base64 32` and add it to .env and the Vercel project.'
    );
  }
  return crypto.createHash('sha256').update(`aethermail:credentials:${secret}`).digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, body]).toString('base64url');
}

export function decryptSecret(sealed: string): string {
  if (!sealed.startsWith(PREFIX)) return sealed;
  const raw = Buffer.from(sealed.slice(PREFIX.length), 'base64url');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const body = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

/** Per-account mail server settings kept in accounts.oauth_tokens (jsonb). */
export interface MailboxConfig {
  /** Sealed with encryptSecret. Legacy rows may hold `app_password` in clear. */
  secret?: string;
  app_password?: string;
  imap_host?: string;
  imap_port?: number;
  spam_folder?: string;
  smtp_host?: string;
  smtp_port?: number;
}

export function readMailboxConfig(raw: unknown): MailboxConfig {
  return raw && typeof raw === 'object' ? (raw as MailboxConfig) : {};
}

/** Returns the mailbox password for an account row, or '' if none is stored. */
export function mailboxPassword(raw: unknown): string {
  const cfg = readMailboxConfig(raw);
  if (cfg.secret) {
    try {
      return decryptSecret(cfg.secret);
    } catch (err) {
      console.warn('[secrets] Could not decrypt stored mailbox password (APP_SECRET changed?):', (err as Error).message);
      return '';
    }
  }
  return typeof cfg.app_password === 'string' ? cfg.app_password : '';
}

/** Strips credentials before an account row goes anywhere near a response. */
export function publicMailboxConfig(raw: unknown) {
  const cfg = readMailboxConfig(raw);
  return {
    imap_host: cfg.imap_host ?? null,
    imap_port: cfg.imap_port ?? null,
    smtp_host: cfg.smtp_host ?? null,
    has_password: Boolean(cfg.secret || cfg.app_password),
  };
}
