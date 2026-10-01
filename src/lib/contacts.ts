import { db } from '../db/index.ts';
import { emails, accounts } from '../db/schema.ts';
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

export async function getContacts(query?: string, limit = 50): Promise<ContactItem[]> {
  const accs = await db.select().from(accounts);
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
    })
    .from(emails)
    .limit(1000);

  for (const r of rows) {
    for (const c of parseContactsFromHeader(r.sender)) {
      const existing = contactsMap.get(c.email) || { email: c.email, name: c.name, count: 0, isAccount: false };
      if (!existing.name && c.name) existing.name = c.name;
      existing.count++;
      contactsMap.set(c.email, existing);
    }
    for (const c of parseContactsFromHeader(r.recipients)) {
      const existing = contactsMap.get(c.email) || { email: c.email, name: c.name, count: 0, isAccount: false };
      if (!existing.name && c.name) existing.name = c.name;
      existing.count++;
      contactsMap.set(c.email, existing);
    }
  }

  let list = Array.from(contactsMap.values()).sort((a, b) => b.count - a.count);

  if (query?.trim()) {
    const q = query.trim().toLowerCase();
    list = list.filter((c) => c.email.toLowerCase().includes(q) || (c.name && c.name.toLowerCase().includes(q)));
  }

  return list.slice(0, Math.max(1, Math.min(limit, 200)));
}
