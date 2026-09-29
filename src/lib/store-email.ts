import { db } from '../db/index.ts';
import { emails, type NewEmail } from '../db/schema.ts';

/**
 * Inserts a message once per mailbox.
 *
 * The primary key is the Message-ID when there is one, which is globally
 * unique — but one message can arrive in two connected mailboxes. When the id
 * is already taken by another mailbox's copy, this copy is stored under an
 * account-suffixed id; the (account_id, message_id) unique index is what
 * actually decides "already have it".
 *
 * Returns true when a new row was written.
 */
export async function storeEmail(rec: NewEmail): Promise<boolean> {
  const first = await db.insert(emails).values(rec).onConflictDoNothing().returning({ id: emails.id });
  if (first.length) return true;
  if (!rec.message_id) return false;

  const second = await db
    .insert(emails)
    .values({ ...rec, id: `${rec.id}#${rec.account_id}` })
    .onConflictDoNothing()
    .returning({ id: emails.id });
  if (second.length) rec.id = second[0].id;
  return second.length > 0;
}
