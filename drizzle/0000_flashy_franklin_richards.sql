CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'google' NOT NULL,
	"email_address" text NOT NULL,
	"oauth_tokens" jsonb,
	"sync_status" text DEFAULT 'synced' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "accounts_email_address_unique" UNIQUE("email_address")
);
--> statement-breakpoint
CREATE TABLE "agent_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"bot_name" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_active" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "agent_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "domains" (
	"id" text PRIMARY KEY NOT NULL,
	"domain_name" text NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"dkim_private_key" text NOT NULL,
	"dkim_public_key" text NOT NULL,
	"dns_mx_record" text NOT NULL,
	"dns_spf_record" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "domains_domain_name_unique" UNIQUE("domain_name")
);
--> statement-breakpoint
CREATE TABLE "emails" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"subject" text NOT NULL,
	"sender" text NOT NULL,
	"body_snippet" text NOT NULL,
	"full_body" text NOT NULL,
	"category" text DEFAULT 'work' NOT NULL,
	"ai_summary" text NOT NULL,
	"requires_alert" boolean DEFAULT false NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"received_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "mailboxes" (
	"id" text PRIMARY KEY NOT NULL,
	"domain_id" text NOT NULL,
	"email_address" text NOT NULL,
	"password_hash" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "mailboxes_email_address_unique" UNIQUE("email_address")
);
--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;