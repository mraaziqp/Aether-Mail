import { db } from '../src/db/index.ts';
import { accounts, emails } from '../src/db/schema.ts';

// Destination database. Env-only: this previously carried a live Neon password
// as a string literal, which published working database credentials to the repo.
//
// Note this is the *target* of the sync, so it is deliberately separate from
// DATABASE_URL (the local source this script reads from).
const connStr = process.env.NEON_TARGET_URL?.trim();
if (!connStr) {
  console.error(
    'NEON_TARGET_URL is not set.\n\n' +
    'Set it to the connection string of the Neon database to sync INTO:\n' +
    '  NEON_TARGET_URL="postgresql://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require" \\\n' +
    '    npx tsx scripts/sync-to-neon.ts\n\n' +
    'DATABASE_URL stays pointed at the local source database.'
  );
  process.exit(1);
}

const neonHost = new URL(connStr.replace(/^postgres(ql)?:\/\//, 'https://')).host;
const neonUrl = `https://${neonHost.replace('-pooler', '')}/sql`;

// Uses fetch rather than shelling out to curl. The old version interpolated the
// connection string into a shell command, which exposed the password in `ps`
// output to every user on the machine and wrote it into shell history.
async function executeNeon(query: string, params: any[] = []) {
  const res = await fetch(neonUrl, {
    method: 'POST',
    headers: {
      'Neon-Connection-String': connStr!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, params }),
  });

  const data = await res.json() as any;
  if (data.message || data.error) {
    throw new Error(data.message || data.error);
  }
  return data;
}

async function main() {
  console.log('Fetching local accounts...');
  const localAccounts = await db.select().from(accounts);
  console.log(`Found ${localAccounts.length} local accounts.`);

  for (const acc of localAccounts) {
    const q = `
      INSERT INTO accounts (id, provider, email_address, oauth_tokens, sync_status, created_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (email_address) DO UPDATE
      SET id = EXCLUDED.id, sync_status = EXCLUDED.sync_status;
    `;
    const tokens = acc.oauth_tokens ? JSON.stringify(acc.oauth_tokens) : null;
    const createdAt = acc.created_at ? acc.created_at.toISOString() : new Date().toISOString();
    await executeNeon(q, [acc.id, acc.provider, acc.email_address, tokens, acc.sync_status, createdAt]);
    console.log(`Synced account: ${acc.email_address}`);
  }

  console.log('Fetching local emails...');
  const localEmails = await db.select().from(emails);
  console.log(`Found ${localEmails.length} local emails.`);

  for (const em of localEmails) {
    const q = `
      INSERT INTO emails (id, account_id, thread_id, subject, sender, body_snippet, full_body, category, ai_summary, requires_alert, is_read, received_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (id) DO UPDATE
      SET is_read = EXCLUDED.is_read, received_at = EXCLUDED.received_at;
    `;
    const receivedAt = em.received_at ? em.received_at.toISOString() : new Date().toISOString();
    await executeNeon(q, [
      em.id,
      em.account_id,
      em.thread_id,
      em.subject,
      em.sender,
      em.body_snippet,
      em.full_body,
      em.category,
      em.ai_summary,
      em.requires_alert,
      em.is_read,
      receivedAt,
    ]);
  }
  console.log(`Successfully synced all ${localEmails.length} emails to Neon!`);
}

main().catch(err => {
  console.error('Sync failed:', err);
  process.exit(1);
});
