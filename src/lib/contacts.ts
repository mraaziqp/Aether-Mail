import { db } from '../db/index.ts';
import { emails, accounts } from '../db/schema.ts';
import { desc } from 'drizzle-orm';
import type { ContactItem } from '../types.ts';

function parseContactsFromHeader(raw: string | null | undefined): Array<{ name: string | null; email: string }> {
  if (!raw) return [];
  const results: Array<{ name: string | null; email: string }> = [];
  // Match either "Name" <email> OR Name <email> OR <email> OR email
  const regex = /(?:(?:"?([^"<,;\n]+)"?)\s*)?<([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>|([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
  let match;
  while ((match = regex.exec(raw)) !== null) {
    const name = (match[1] || '').trim();
    const email = (match[2] || match[3] || '').trim().toLowerCase();
    if (email && email.includes('@')) {
      results.push({ name: name || null, email });
    }
  }
  return results;
}

async function buildContacts(): Promise<Map<string, ContactItem>> {
  const accs = await db.select({ email_address: accounts.email_address, display_name: accounts.display_name }).from(accounts);
  const contactsMap = new Map<string, ContactItem>();

  for (const a of accs) {
    contactsMap.set(a.email_address.toLowerCase(), {
      email: a.email_address.toLowerCase(),
      name: a.display_name || null,
      count: 100,
      isAccount: true,
    });
  }

  const rows = await db
    .select({
      sender: emails.sender,
      recipients: emails.recipients,
      delivery_status: emails.delivery_status,
    })
    .from(emails)
    .orderBy(desc(emails.received_at))
    .limit(2000);

  for (const r of rows) {
    // A bounced send's recipients are often typos; never offer them back.
    const undeliverable = r.delivery_status === 'bounced' || r.delivery_status === 'failed';
    for (const c of parseContactsFromHeader(r.sender)) {
      const existing = contactsMap.get(c.email) || { email: c.email, name: c.name, count: 0, isAccount: false };
      if (!existing.name && c.name) existing.name = c.name;
      existing.count++;
      contactsMap.set(c.email, existing);
    }
    for (const c of undeliverable ? [] : parseContactsFromHeader(r.recipients)) {
      const existing = contactsMap.get(c.email) || { email: c.email, name: c.name, count: 0, isAccount: false };
      if (!existing.name && c.name) existing.name = c.name;
      existing.count++;
      contactsMap.set(c.email, existing);
    }
  }

  return contactsMap;
}

export async function getContacts(query?: string, limit = 50): Promise<ContactItem[]> {
  let list = Array.from((await buildContacts()).values()).sort((a, b) => b.count - a.count);

  if (query?.trim()) {
    const q = query.trim().toLowerCase();
    list = list.filter((c) => c.email.toLowerCase().includes(q) || (c.name && c.name.toLowerCase().includes(q)));
  }

  return list.slice(0, Math.max(1, Math.min(limit, 200)));
}

let domainCache: { at: number; domains: Set<string> } | null = null;

/** Every domain seen in mail or mailboxes; cached briefly, feeds typo suggestions. */
export async function knownDomains(): Promise<Set<string>> {
  if (domainCache && Date.now() - domainCache.at < 5 * 60_000) return domainCache.domains;
  const domains = new Set<string>();
  for (const email of (await buildContacts()).keys()) domains.add(email.split('@')[1]);
  domainCache = { at: Date.now(), domains };
  return domains;
}
