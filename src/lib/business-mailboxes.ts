import { db } from '../db/index.ts';
import { accounts } from '../db/schema.ts';

/**
 * Makes the business addresses exist as mailboxes before any mail arrives, so
 * they can send immediately and show up in the sidebar.
 *
 * With Resend receiving, a mailbox row is also created automatically for any
 * address on the domain the first time mail arrives for it (catch-all); this
 * just seeds the ones you want from day one.
 *
 *   BUSINESS_DOMAIN=arpcloudsolutions.co.za
 *   BUSINESS_MAILBOXES=contact,info,sales,billing
 */
/** The business domain: BUSINESS_DOMAIN, else the domain of AETHERMAIL_SENDER. */
export function businessDomain(): string | null {
  return (
    process.env.BUSINESS_DOMAIN?.trim().toLowerCase() ||
    process.env.AETHERMAIL_SENDER?.trim().toLowerCase().split('@')[1] ||
    null
  );
}

export async function ensureBusinessMailboxes() {
  const domain = businessDomain();
  const list = process.env.BUSINESS_MAILBOXES?.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) ?? [];
  if (!list.length) return;

  const addresses = list.map((x) => (x.includes('@') ? x : domain ? `${x}@${domain}` : '')).filter((a) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a));
  if (!addresses.length) return;

  const name = process.env.BUSINESS_NAME?.trim() || null;
  await db
    .insert(accounts)
    .values(
      addresses.map((email, i) => ({
        id: `acc_biz_${email.replace(/[^a-z0-9]/g, '_')}`,
        provider: 'resend',
        email_address: email,
        display_name: i === 0 ? name : null,
        sync_status: 'synced',
      }))
    )
    .onConflictDoUpdate({
      target: accounts.email_address,
      set: {
        provider: 'resend',
        sync_status: 'synced',
        last_sync_error: null,
      },
    });
}
