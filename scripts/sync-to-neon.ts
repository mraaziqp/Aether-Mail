import { db } from '../src/db/index.ts';
import { accounts, emails } from '../src/db/schema.ts';
import { execSync } from 'child_process';

const connStr = 'postgresql://neondb_owner:npg_EQSZe2r6pvjL@ep-morning-union-azb7i5ap.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';
const neonUrl = 'https://ep-morning-union-azb7i5ap.c-3.ap-southeast-1.aws.neon.tech/sql';

function executeNeon(query: string, params: any[] = []) {
  const payload = JSON.stringify({ query, params });
  const resStr = execSync('curl -s -4 -H "Neon-Connection-String: ' + connStr + '" -H "Content-Type: application/json" -d @- "' + neonUrl + '"', {
    input: payload,
    encoding: 'utf8',
  });
  const data = JSON.parse(resStr);
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
    executeNeon(q, [acc.id, acc.provider, acc.email_address, tokens, acc.sync_status, createdAt]);
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
    executeNeon(q, [
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
