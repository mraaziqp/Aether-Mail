import { pgTable, text, boolean, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull().default('google'),
  email_address: text('email_address').notNull().unique(),
  oauth_tokens: jsonb('oauth_tokens'),
  sync_status: text('sync_status').notNull().default('synced'),
  created_at: timestamp('created_at').defaultNow(),
});

export const emails = pgTable('emails', {
  id: text('id').primaryKey(),
  account_id: text('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  thread_id: text('thread_id').notNull(),
  subject: text('subject').notNull(),
  sender: text('sender').notNull(),
  body_snippet: text('body_snippet').notNull(),
  full_body: text('full_body').notNull(),
  category: text('category').notNull().default('work'), // 'urgent' | 'personal' | 'newsletter' | 'automated' | 'work' | 'financial'
  ai_summary: text('ai_summary').notNull(),
  requires_alert: boolean('requires_alert').notNull().default(false),
  is_read: boolean('is_read').notNull().default(false),
  received_at: timestamp('received_at').defaultNow(),
});

export const accountsRelations = relations(accounts, ({ many }) => ({
  emails: many(emails),
}));

export const emailsRelations = relations(emails, ({ one }) => ({
  account: one(accounts, {
    fields: [emails.account_id],
    references: [accounts.id],
  }),
}));

export const api_keys = pgTable('api_keys', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  key_hash: text('key_hash').notNull().unique(),
  prefix: text('prefix').notNull(),
  scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
  last_used_at: timestamp('last_used_at'),
  created_at: timestamp('created_at').defaultNow(),
});

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Email = typeof emails.$inferSelect;
export type NewEmail = typeof emails.$inferInsert;
export type ApiKey = typeof api_keys.$inferSelect;
export type NewApiKey = typeof api_keys.$inferInsert;

export type EmailCategory = 'urgent' | 'personal' | 'newsletter' | 'automated' | 'work' | 'financial';
