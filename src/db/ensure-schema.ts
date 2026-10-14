import { pool } from './index.ts';

/**
 * Idempotent schema bootstrap, run once per process before the first query.
 *
 * `drizzle-kit push` stays the canonical way to manage the schema, but a deploy
 * must never start selecting columns that the database does not have yet: that
 * turns every request into a 500 until someone remembers to push. Every
 * statement here is IF NOT EXISTS, so it is a no-op on an up-to-date database
 * and brings a fresh one (a new Neon project, say) up in one round trip.
 */
const DDL = `
-- One bootstrap at a time: parallel cold starts would otherwise race on CREATE INDEX.
SELECT pg_advisory_xact_lock(727274);
CREATE TABLE IF NOT EXISTS accounts (
  id text PRIMARY KEY NOT NULL,
  provider text DEFAULT 'google' NOT NULL,
  email_address text NOT NULL UNIQUE,
  oauth_tokens jsonb,
  sync_status text DEFAULT 'synced' NOT NULL,
  created_at timestamp DEFAULT now()
);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_synced_at timestamp;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_sync_error text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS sync_lease_until timestamp;

CREATE TABLE IF NOT EXISTS emails (
  id text PRIMARY KEY NOT NULL,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  thread_id text NOT NULL,
  subject text NOT NULL,
  sender text NOT NULL,
  body_snippet text NOT NULL,
  full_body text NOT NULL,
  category text DEFAULT 'work' NOT NULL,
  ai_summary text NOT NULL,
  requires_alert boolean DEFAULT false NOT NULL,
  is_read boolean DEFAULT false NOT NULL,
  received_at timestamp DEFAULT now()
);
ALTER TABLE emails ADD COLUMN IF NOT EXISTS message_id text;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS recipients text;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS direction text DEFAULT 'inbound' NOT NULL;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS folder text;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS has_attachments boolean DEFAULT false NOT NULL;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS delivery_status text;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS delivery_detail text;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS delivery_updated_at timestamp;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS provider_message_id text;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS transport text;
CREATE INDEX IF NOT EXISTS emails_provider_message_idx ON emails (provider_message_id);
CREATE INDEX IF NOT EXISTS emails_received_at_idx ON emails (received_at);
CREATE INDEX IF NOT EXISTS emails_account_received_idx ON emails (account_id, received_at);
CREATE INDEX IF NOT EXISTS emails_category_idx ON emails (category);
-- Rows written before message_id existed used the Message-ID as their id.
UPDATE emails SET message_id = id WHERE message_id IS NULL AND id LIKE '<%>';
CREATE UNIQUE INDEX IF NOT EXISTS emails_account_message_uidx ON emails (account_id, message_id);
CREATE INDEX IF NOT EXISTS emails_thread_idx ON emails (thread_id);

CREATE TABLE IF NOT EXISTS sync_state (
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  folder text NOT NULL,
  uid_validity bigint NOT NULL,
  last_uid bigint DEFAULT 0 NOT NULL,
  updated_at timestamp DEFAULT now(),
  PRIMARY KEY (account_id, folder)
);

CREATE TABLE IF NOT EXISTS api_keys (
  id text PRIMARY KEY NOT NULL,
  name text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  prefix text NOT NULL,
  scopes jsonb DEFAULT '[]'::jsonb NOT NULL,
  last_used_at timestamp,
  created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_keys (
  id text PRIMARY KEY NOT NULL,
  bot_name text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  scopes jsonb DEFAULT '[]'::jsonb NOT NULL,
  last_active timestamp,
  created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS domains (
  id text PRIMARY KEY NOT NULL,
  domain_name text NOT NULL UNIQUE,
  is_verified boolean DEFAULT false NOT NULL,
  dkim_private_key text NOT NULL,
  dkim_public_key text NOT NULL,
  dns_mx_record text NOT NULL,
  dns_spf_record text NOT NULL,
  created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mailboxes (
  id text PRIMARY KEY NOT NULL,
  domain_id text NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  email_address text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp DEFAULT now()
);
`;

/**
 * Bump whenever DDL above changes. The database records the version it was
 * brought to, and an up-to-date database skips the DDL entirely: ALTER TABLE
 * takes an ACCESS EXCLUSIVE lock even when IF NOT EXISTS makes it a no-op, so
 * running it on every serverless cold start stalls live queries on `emails`
 * and can deadlock with them.
 */
const SCHEMA_VERSION = 'aethermail-schema:2026-10-14';

async function migrateIfNeeded() {
  const { rows } = await pool.query<{ v: string | null }>(
    `SELECT obj_description(to_regclass('public.emails'), 'pg_class') AS v`
  );
  if (rows[0]?.v === SCHEMA_VERSION) return;
  await pool.query(`${DDL}\nCOMMENT ON TABLE emails IS '${SCHEMA_VERSION}';`);
}

let ready: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  if (!ready) {
    ready = migrateIfNeeded().then(
      async () => {
        const { ensureBusinessMailboxes } = await import('../lib/business-mailboxes.ts');
        await ensureBusinessMailboxes().catch((err) => console.warn('[schema] business mailboxes not seeded:', err.message));
      },
      (err) => {
        // Let the next request retry rather than caching a transient failure
        // (Neon cold start, network blip) for the life of the process.
        ready = null;
        throw err;
      }
    );
  }
  return ready;
}
