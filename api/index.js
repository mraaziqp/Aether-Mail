var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/db/schema.ts
var schema_exports = {};
__export(schema_exports, {
  accounts: () => accounts,
  accountsRelations: () => accountsRelations,
  agent_keys: () => agent_keys,
  api_keys: () => api_keys,
  domains: () => domains,
  domainsRelations: () => domainsRelations,
  emails: () => emails,
  emailsRelations: () => emailsRelations,
  mailboxes: () => mailboxes,
  mailboxesRelations: () => mailboxesRelations,
  sync_state: () => sync_state
});
import { pgTable, text, boolean, timestamp, jsonb, bigint, index, uniqueIndex, primaryKey } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
var accounts, emails, sync_state, accountsRelations, emailsRelations, api_keys, domains, mailboxes, agent_keys, domainsRelations, mailboxesRelations;
var init_schema = __esm({
  "src/db/schema.ts"() {
    accounts = pgTable("accounts", {
      id: text("id").primaryKey(),
      provider: text("provider").notNull().default("google"),
      email_address: text("email_address").notNull().unique(),
      oauth_tokens: jsonb("oauth_tokens"),
      sync_status: text("sync_status").notNull().default("synced"),
      created_at: timestamp("created_at").defaultNow(),
      display_name: text("display_name"),
      last_synced_at: timestamp("last_synced_at"),
      last_sync_error: text("last_sync_error"),
      /** Cross-instance sync lock: a sync only runs while it holds an unexpired lease. */
      sync_lease_until: timestamp("sync_lease_until")
    });
    emails = pgTable("emails", {
      id: text("id").primaryKey(),
      account_id: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
      thread_id: text("thread_id").notNull(),
      subject: text("subject").notNull(),
      sender: text("sender").notNull(),
      body_snippet: text("body_snippet").notNull(),
      full_body: text("full_body").notNull(),
      category: text("category").notNull().default("work"),
      // 'urgent' | 'personal' | 'newsletter' | 'automated' | 'work' | 'financial'
      ai_summary: text("ai_summary").notNull(),
      requires_alert: boolean("requires_alert").notNull().default(false),
      is_read: boolean("is_read").notNull().default(false),
      received_at: timestamp("received_at").defaultNow(),
      /** RFC 5322 Message-ID header, used for reply threading. */
      message_id: text("message_id"),
      recipients: text("recipients"),
      /** 'inbound' | 'outbound' */
      direction: text("direction").notNull().default("inbound"),
      folder: text("folder"),
      has_attachments: boolean("has_attachments").notNull().default(false)
    }, (t) => [
      index("emails_received_at_idx").on(t.received_at),
      index("emails_account_received_idx").on(t.account_id, t.received_at),
      index("emails_category_idx").on(t.category),
      index("emails_thread_idx").on(t.thread_id),
      // The same message can legitimately sit in two connected mailboxes (sent to
      // contact@ and info@): dedupe per account, not globally.
      uniqueIndex("emails_account_message_uidx").on(t.account_id, t.message_id)
    ]);
    sync_state = pgTable("sync_state", {
      account_id: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
      folder: text("folder").notNull(),
      uid_validity: bigint("uid_validity", { mode: "number" }).notNull(),
      last_uid: bigint("last_uid", { mode: "number" }).notNull().default(0),
      updated_at: timestamp("updated_at").defaultNow()
    }, (t) => [primaryKey({ columns: [t.account_id, t.folder] })]);
    accountsRelations = relations(accounts, ({ many }) => ({
      emails: many(emails)
    }));
    emailsRelations = relations(emails, ({ one }) => ({
      account: one(accounts, {
        fields: [emails.account_id],
        references: [accounts.id]
      })
    }));
    api_keys = pgTable("api_keys", {
      id: text("id").primaryKey(),
      name: text("name").notNull(),
      key_hash: text("key_hash").notNull().unique(),
      prefix: text("prefix").notNull(),
      scopes: jsonb("scopes").$type().notNull().default([]),
      last_used_at: timestamp("last_used_at"),
      created_at: timestamp("created_at").defaultNow()
    });
    domains = pgTable("domains", {
      id: text("id").primaryKey(),
      domain_name: text("domain_name").notNull().unique(),
      is_verified: boolean("is_verified").notNull().default(false),
      dkim_private_key: text("dkim_private_key").notNull(),
      dkim_public_key: text("dkim_public_key").notNull(),
      dns_mx_record: text("dns_mx_record").notNull(),
      dns_spf_record: text("dns_spf_record").notNull(),
      created_at: timestamp("created_at").defaultNow()
    });
    mailboxes = pgTable("mailboxes", {
      id: text("id").primaryKey(),
      domain_id: text("domain_id").notNull().references(() => domains.id, { onDelete: "cascade" }),
      email_address: text("email_address").notNull().unique(),
      password_hash: text("password_hash").notNull(),
      is_active: boolean("is_active").notNull().default(true),
      created_at: timestamp("created_at").defaultNow()
    });
    agent_keys = pgTable("agent_keys", {
      id: text("id").primaryKey(),
      bot_name: text("bot_name").notNull(),
      // e.g., "Jarvis"
      key_hash: text("key_hash").notNull().unique(),
      scopes: jsonb("scopes").$type().notNull().default([]),
      // super_admin, read_all, send_as_any
      last_active: timestamp("last_active"),
      created_at: timestamp("created_at").defaultNow()
    });
    domainsRelations = relations(domains, ({ many }) => ({
      mailboxes: many(mailboxes)
    }));
    mailboxesRelations = relations(mailboxes, ({ one }) => ({
      domain: one(domains, {
        fields: [mailboxes.domain_id],
        references: [domains.id]
      })
    }));
  }
});

// src/db/index.ts
import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
var Pool, createPool, pool, db;
var init_db = __esm({
  "src/db/index.ts"() {
    init_schema();
    ({ Pool } = pg);
    createPool = () => {
      if (!global._postgresPool) {
        const rawUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL_NON_POOLING;
        if (rawUrl) {
          let cleanUrl = rawUrl;
          try {
            const parsed = new URL(rawUrl);
            parsed.searchParams.delete("channel_binding");
            cleanUrl = parsed.toString();
          } catch {
            cleanUrl = rawUrl.replace(/[?&]channel_binding=[^&]*/g, "");
          }
          const isRemote = cleanUrl.includes("neon.tech") || cleanUrl.includes("sslmode=require") || cleanUrl.includes("supabase.co") || process.env.NODE_ENV === "production" || !!process.env.VERCEL;
          global._postgresPool = new Pool({
            connectionString: cleanUrl,
            ssl: isRemote ? { rejectUnauthorized: false } : false,
            max: process.env.VERCEL ? 3 : 10,
            connectionTimeoutMillis: 1e4,
            idleTimeoutMillis: 3e4
          });
        } else if (process.env.POSTGRES_HOST || process.env.PGHOST) {
          const host = process.env.POSTGRES_HOST || process.env.PGHOST || "localhost";
          const user = process.env.POSTGRES_USER || process.env.PGUSER || "postgres";
          const password = process.env.POSTGRES_PASSWORD || process.env.PGPASSWORD || "";
          const database = process.env.POSTGRES_DATABASE || process.env.PGDATABASE || "postgres";
          const isRemote = host !== "localhost" && host !== "127.0.0.1";
          global._postgresPool = new Pool({
            host,
            user,
            password,
            database,
            port: Number(process.env.PGPORT) || 5432,
            ssl: isRemote ? { rejectUnauthorized: false } : false,
            max: process.env.VERCEL ? 3 : 10,
            connectionTimeoutMillis: 1e4
          });
        } else {
          global._postgresPool = new Pool({
            host: process.env.SQL_HOST || "localhost",
            user: process.env.SQL_USER || "postgres",
            password: process.env.SQL_PASSWORD || "",
            database: process.env.SQL_DB_NAME || "postgres",
            port: Number(process.env.SQL_PORT) || 5432,
            max: 10,
            connectionTimeoutMillis: 15e3,
            ssl: false
          });
        }
        global._postgresPool.on("error", (err) => {
          console.error("Unexpected error on idle SQL pool client:", err);
        });
      }
      return global._postgresPool;
    };
    pool = createPool();
    db = drizzle(pool, { schema: schema_exports });
  }
});

// src/lib/business-mailboxes.ts
var business_mailboxes_exports = {};
__export(business_mailboxes_exports, {
  businessDomain: () => businessDomain,
  ensureBusinessMailboxes: () => ensureBusinessMailboxes
});
function businessDomain() {
  return process.env.BUSINESS_DOMAIN?.trim().toLowerCase() || process.env.AETHERMAIL_SENDER?.trim().toLowerCase().split("@")[1] || null;
}
async function ensureBusinessMailboxes() {
  const domain = businessDomain();
  const list = process.env.BUSINESS_MAILBOXES?.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) ?? [];
  if (!list.length) return;
  const addresses = list.map((x) => x.includes("@") ? x : domain ? `${x}@${domain}` : "").filter((a) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a));
  if (!addresses.length) return;
  const name = process.env.BUSINESS_NAME?.trim() || null;
  await db.insert(accounts).values(
    addresses.map((email, i) => ({
      id: `acc_biz_${email.replace(/[^a-z0-9]/g, "_")}`,
      provider: "resend",
      email_address: email,
      display_name: i === 0 ? name : null,
      sync_status: "synced"
    }))
  ).onConflictDoNothing();
}
var init_business_mailboxes = __esm({
  "src/lib/business-mailboxes.ts"() {
    init_db();
    init_schema();
  }
});

// src/lib/gemini.ts
import { GoogleGenAI, Type } from "@google/genai";
function isAiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY?.trim() || process.env.LOCAL_LLM_URL?.trim());
}
function getGeminiClient() {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    aiClient = new GoogleGenAI(apiKey ? { apiKey } : {});
  }
  return aiClient;
}
async function classifyWithLocalModel(prompt) {
  if (!process.env.LOCAL_LLM_URL?.trim()) return null;
  const baseUrl = process.env.LOCAL_LLM_URL.trim().replace(/\/$/, "");
  const model = process.env.LOCAL_LLM_MODEL || "llama3.1:8b";
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: 'You classify email. Reply with ONLY a JSON object, no prose and no code fences: {"category":"urgent|personal|newsletter|automated|work|financial","summary":"one sentence","requires_alert":true|false}'
          },
          { role: "user", content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 200
      }),
      // Local inference is slow and this runs during ingestion, so bound it.
      signal: AbortSignal.timeout(Number(process.env.LOCAL_LLM_TIMEOUT_MS) || 3e4)
    });
    if (!res.ok) return null;
    const json = await res.json();
    const raw = json.choices?.[0]?.message?.content ?? "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (typeof parsed.category !== "string" || !VALID_CATEGORIES.has(parsed.category)) return null;
    return {
      category: parsed.category,
      summary: typeof parsed.summary === "string" && parsed.summary.trim() ? parsed.summary.trim() : "No summary produced.",
      requires_alert: parsed.requires_alert === true
    };
  } catch {
    return null;
  }
}
async function processEmailWithGemini(params) {
  return await classifyWithAi(params) ?? keywordFallback(params);
}
async function classifyWithAi(params) {
  const prompt = `Analyze this incoming email and extract structured metadata:
Sender: ${params.sender}
Subject: ${params.subject}

Body:
${params.body}

Guidelines:
1. "category" must be strictly one of: urgent, personal, newsletter, automated, work, financial.
2. "summary" must be a strict 1-sentence TL;DR highlighting the main outcome, request, or action item.
3. "requires_alert" must be true if this email requires immediate human attention (e.g. critical security issue, server outage, urgent financial action, tight turnaround deadline). Otherwise false.`;
  if (!process.env.GEMINI_API_KEY) {
    return classifyWithLocalModel(prompt);
  }
  const ai = getGeminiClient();
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            category: {
              type: Type.STRING,
              enum: ["urgent", "personal", "newsletter", "automated", "work", "financial"]
            },
            summary: {
              type: Type.STRING,
              description: "A strict 1-sentence TL;DR"
            },
            requires_alert: {
              type: Type.BOOLEAN,
              description: "True if the email needs immediate human attention"
            }
          },
          required: ["category", "summary", "requires_alert"]
        }
      }
    });
    const text2 = response.text;
    if (!text2) {
      throw new Error("No text returned from Gemini");
    }
    const parsed = JSON.parse(text2);
    if (!VALID_CATEGORIES.has(parsed.category)) return null;
    return parsed;
  } catch (error) {
    console.error("Gemini extraction error:", error instanceof Error ? error.message : error);
    return null;
  }
}
function keywordFallback(params) {
  {
    const content = `${params.subject} ${params.body}`.toLowerCase();
    let category = "work";
    let requires_alert = false;
    if (content.includes("urgent") || content.includes("emergency") || content.includes("critical") || content.includes("action required")) {
      category = "urgent";
      requires_alert = true;
    } else if (content.includes("invoice") || content.includes("billing") || content.includes("receipt") || content.includes("payment") || content.includes("wire transfer")) {
      category = "financial";
    } else if (content.includes("newsletter") || content.includes("digest") || content.includes("unsubscribe")) {
      category = "newsletter";
    } else if (content.includes("noreply") || content.includes("no-reply") || content.includes("automated") || content.includes("system")) {
      category = "automated";
    } else if (content.includes("dinner") || content.includes("family") || content.includes("weekend") || content.includes("coffee")) {
      category = "personal";
    }
    return {
      category,
      summary: `${params.subject}: ${params.body.slice(0, 100).replace(/\s+/g, " ").trim()}...`,
      requires_alert
    };
  }
}
async function generateSmartReplyWithGemini(params) {
  const ai = getGeminiClient();
  const tone = params.tone || "professional";
  const instructions = params.instructions ? `Custom user instruction: ${params.instructions}` : "";
  const prompt = `You are an expert executive email assistant drafting a smart email reply.
Original Sender: ${params.sender}
Original Subject: ${params.subject}
AI Summary of original email: ${params.aiSummary}

Original Full Body:
${params.body}

Desired Tone: ${tone} (e.g. professional, concise, friendly, or firm)
${instructions}

Instructions:
- Write a ready-to-send email reply.
- Directly address all inquiries, questions, or action items raised in the original message.
- Keep the formatting neat with proper greeting, paragraph breaks, and sign-off placeholder [Your Name].
- Do not add meta-commentary, markdown backticks, or "Here is your draft:". Only output the clean email draft.`;
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt
    });
    return response.text?.trim() || "Hi,\n\nThank you for your message. I have reviewed the details and will follow up with you shortly.\n\nBest regards,\n[Your Name]";
  } catch (err) {
    console.error("Smart reply generation error:", err);
    return `Hi,

Thank you for reaching out regarding "${params.subject}". I have received your email and will get back to you with the required details as soon as possible.

Best regards,
[Your Name]`;
  }
}
var aiClient, VALID_CATEGORIES;
var init_gemini = __esm({
  "src/lib/gemini.ts"() {
    aiClient = null;
    VALID_CATEGORIES = /* @__PURE__ */ new Set([
      "urgent",
      "personal",
      "newsletter",
      "automated",
      "work",
      "financial"
    ]);
  }
});

// src/lib/secrets.ts
import crypto from "node:crypto";
function key() {
  const secret = process.env.APP_SECRET?.trim();
  if (!secret) {
    throw new Error(
      "APP_SECRET is not set. It encrypts stored mailbox passwords \u2014 generate one with `openssl rand -base64 32` and add it to .env and the Vercel project."
    );
  }
  return crypto.createHash("sha256").update(`aethermail:credentials:${secret}`).digest();
}
function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, body]).toString("base64url");
}
function decryptSecret(sealed) {
  if (!sealed.startsWith(PREFIX)) return sealed;
  const raw = Buffer.from(sealed.slice(PREFIX.length), "base64url");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const body = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}
function readMailboxConfig(raw) {
  return raw && typeof raw === "object" ? raw : {};
}
function mailboxPassword(raw) {
  const cfg = readMailboxConfig(raw);
  if (cfg.secret) {
    try {
      return decryptSecret(cfg.secret);
    } catch (err) {
      console.warn("[secrets] Could not decrypt stored mailbox password (APP_SECRET changed?):", err.message);
      return "";
    }
  }
  return typeof cfg.app_password === "string" ? cfg.app_password : "";
}
function publicMailboxConfig(raw) {
  const cfg = readMailboxConfig(raw);
  return {
    imap_host: cfg.imap_host ?? null,
    imap_port: cfg.imap_port ?? null,
    smtp_host: cfg.smtp_host ?? null,
    has_password: Boolean(cfg.secret || cfg.app_password)
  };
}
var PREFIX;
var init_secrets = __esm({
  "src/lib/secrets.ts"() {
    PREFIX = "enc:v1:";
  }
});

// src/lib/store-email.ts
async function storeEmail(rec) {
  const first = await db.insert(emails).values(rec).onConflictDoNothing().returning({ id: emails.id });
  if (first.length) return true;
  if (!rec.message_id) return false;
  const second = await db.insert(emails).values({ ...rec, id: `${rec.id}#${rec.account_id}` }).onConflictDoNothing().returning({ id: emails.id });
  if (second.length) rec.id = second[0].id;
  return second.length > 0;
}
var init_store_email = __esm({
  "src/lib/store-email.ts"() {
    init_db();
    init_schema();
  }
});

// src/lib/classify.ts
function heuristicClassify(input) {
  if (input.folderKind === "spam") return { category: "spam", requires_alert: false };
  const subject = input.subject.toLowerCase();
  const sender = input.sender.toLowerCase();
  const body = input.text.slice(0, 4e3).toLowerCase();
  if (has(subject, ["payfast"])) return { category: "financial", requires_alert: true };
  if (has(subject, ["urgent", "action required", "immediate", "outage", "incident", "critical", "security alert", "suspicious", "password reset", "verify your", "expires today", "final notice"])) {
    return { category: "urgent", requires_alert: true };
  }
  if (has(subject, ["invoice", "payment", "receipt", "statement", "bank", "quote", "quotation", "purchase order", "remittance", "eft", "refund", "billing"])) {
    return {
      category: "financial",
      requires_alert: has(subject, ["overdue", "failed", "declined", "action", "verify"])
    };
  }
  const automatedSender = has(sender, ["no-reply", "noreply", "donotreply", "do-not-reply", "notifications@", "mailer-daemon", "postmaster@", "alerts@"]);
  if (sender.includes("mailer-daemon") || subject.includes("undeliverable") || subject.includes("delivery status notification")) {
    return { category: "automated", requires_alert: true };
  }
  if (has(body, ["unsubscribe", "view this email in your browser", "manage your preferences"]) || has(subject, ["newsletter", "digest", "weekly", "webinar"])) {
    return { category: automatedSender ? "automated" : "newsletter", requires_alert: false };
  }
  if (automatedSender) return { category: "automated", requires_alert: false };
  if (has(subject, ["meeting", "project", "proposal", "contract", "client", "deadline", "enquiry", "inquiry", "request", "quote", "website", "hosting", "domain", "support"])) {
    return { category: "work", requires_alert: false };
  }
  return { category: "personal", requires_alert: false };
}
var has;
var init_classify = __esm({
  "src/lib/classify.ts"() {
    has = (hay, needles) => needles.some((n) => hay.includes(n));
  }
});

// src/lib/notify.ts
async function pushAlert(input) {
  const topic = process.env.NTFY_TOPIC?.trim();
  if (!topic) return false;
  const server = (process.env.NTFY_URL?.trim() || "https://ntfy.sh").replace(/\/$/, "");
  const headers = { "Content-Type": "application/json" };
  if (process.env.NTFY_TOKEN?.trim()) headers.Authorization = `Bearer ${process.env.NTFY_TOKEN.trim()}`;
  try {
    const res = await fetch(server, {
      method: "POST",
      headers,
      body: JSON.stringify({
        topic,
        title: `AetherMail \xB7 ${input.subject.slice(0, 80)}`,
        message: `${input.account ? `To: ${input.account}
` : ""}From: ${input.sender}

${input.summary.slice(0, 280)}`,
        priority: 4,
        tags: ["envelope", "warning"],
        ...process.env.APP_URL ? { click: process.env.APP_URL } : {}
      }),
      signal: AbortSignal.timeout(4e3)
    });
    return res.ok;
  } catch (err) {
    console.warn("[ntfy] push failed:", err.message);
    return false;
  }
}
var init_notify = __esm({
  "src/lib/notify.ts"() {
  }
});

// src/lib/imap-sync.ts
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { and as and2, eq as eq5 } from "drizzle-orm";
function resolveImapProvider(emailAddress, cfg = {}) {
  const domain = emailAddress.split("@")[1]?.toLowerCase() ?? "";
  const known = PROVIDERS[domain];
  if (cfg.imap_host) {
    return {
      host: cfg.imap_host,
      port: cfg.imap_port || 993,
      provider: known?.provider || (cfg.imap_host.includes("zoho") ? "zoho" : "imap"),
      spamFolder: cfg.spam_folder || known?.spamFolder || "Spam"
    };
  }
  if (known) return known;
  const host = process.env.IMAP_HOST?.trim();
  if (!host) {
    throw new Error(
      `No IMAP server known for "${domain}". Save the IMAP host on the account (Connect mailbox \u2192 Server) or set IMAP_HOST \u2014 e.g. imappro.zoho.com for a custom domain on Zoho Mail.`
    );
  }
  return {
    host,
    port: Number(process.env.IMAP_PORT) || 993,
    provider: process.env.IMAP_PROVIDER?.trim() || "imap",
    spamFolder: process.env.IMAP_SPAM_FOLDER?.trim() || "Spam"
  };
}
function createImapClient(emailAddress, password, target) {
  const allowSelfSigned = process.env.IMAP_ALLOW_SELF_SIGNED === "true";
  return new ImapFlow({
    host: target.host,
    port: target.port,
    secure: target.port !== 143,
    auth: { user: emailAddress.trim().toLowerCase(), pass: password.replace(/\s+/g, "") },
    logger: false,
    tls: { rejectUnauthorized: !allowSelfSigned },
    clientInfo: { name: "AetherMail", version: "3.0" },
    connectionTimeout: 12e3,
    greetingTimeout: 8e3,
    socketTimeout: 6e4
  });
}
async function closeQuietly(client) {
  try {
    if (client.usable) await client.logout();
    else client.close();
  } catch {
    try {
      client.close();
    } catch {
    }
  }
}
async function testImapLogin(emailAddress, password, cfg = {}) {
  const target = resolveImapProvider(emailAddress, cfg);
  const client = createImapClient(emailAddress, password, target);
  try {
    await client.connect();
    const boxes = await client.list();
    return { ok: true, host: target.host, folders: boxes.map((b) => b.path) };
  } catch (err) {
    return { ok: false, host: target.host, error: describeImapError(err) };
  } finally {
    await closeQuietly(client);
  }
}
function describeImapError(err) {
  const e = err;
  if (e?.authenticationFailed) {
    return `Login rejected by the mail server${e.responseText ? ` (${e.responseText})` : ""}. Use an app-specific password (Gmail and Zoho both require one when 2FA is on), and check IMAP access is enabled for the mailbox.`;
  }
  if (e?.code === "ENOTFOUND") return `Mail server host not found (${e.message}). Check the IMAP host.`;
  if (e?.code === "ETIMEDOUT" || e?.code === "ECONNREFUSED") return `Could not reach the mail server (${e.code}). Check host and port 993.`;
  return e?.responseText || e?.message || String(err);
}
function pickFolders(boxes, target) {
  const out = [{ path: "INBOX", kind: "inbox" }];
  const bySpecial = (flag) => boxes.find((b) => b.specialUse === flag)?.path;
  const byName = (name) => boxes.find((b) => b.path.toLowerCase() === name.toLowerCase())?.path;
  const junk = bySpecial("\\Junk") || byName(target.spamFolder) || byName("Spam") || byName("Junk");
  if (junk) out.push({ path: junk, kind: "spam" });
  if (process.env.IMAP_SYNC_SENT !== "false") {
    const sent = bySpecial("\\Sent") || byName("Sent") || byName("Sent Items") || byName("[Gmail]/Sent Mail");
    if (sent) out.push({ path: sent, kind: "sent" });
  }
  return out;
}
async function syncMailbox(account, password, opts = {}) {
  const deadline = opts.deadline ?? Date.now() + 45e3;
  const backfill = opts.backfill ?? (Number(process.env.IMAP_BACKFILL) || 50);
  const cfg = readMailboxConfig(account.oauth_tokens);
  const selfAddress = account.email_address.trim().toLowerCase();
  let target;
  try {
    target = resolveImapProvider(selfAddress, cfg);
  } catch (err) {
    return { success: false, imported: 0, error: err.message };
  }
  const client = createImapClient(selfAddress, password, target);
  client.on("error", (err) => console.warn(`[IMAP ${selfAddress}] connection error:`, err?.message));
  let imported = 0;
  const newIds = [];
  let partial = false;
  try {
    await client.connect();
    const boxes = await client.list();
    const folders = pickFolders(boxes, target);
    const states = new Map(
      (await db.select().from(sync_state).where(eq5(sync_state.account_id, account.id))).map((s) => [s.folder, s])
    );
    for (const folder of folders) {
      if (Date.now() > deadline) {
        partial = true;
        break;
      }
      let status;
      try {
        status = await client.status(folder.path, { messages: true, uidNext: true, uidValidity: true });
      } catch {
        continue;
      }
      const validity = Number(status.uidValidity ?? 0);
      const uidNext = status.uidNext ?? 0;
      const total = status.messages ?? 0;
      const prev = states.get(folder.path);
      const fresh = !prev || prev.uid_validity !== validity;
      if (!fresh && uidNext > 0 && uidNext - 1 <= prev.last_uid) continue;
      const saveState = async (lastUid) => {
        await db.insert(sync_state).values({ account_id: account.id, folder: folder.path, uid_validity: validity, last_uid: lastUid, updated_at: /* @__PURE__ */ new Date() }).onConflictDoUpdate({
          target: [sync_state.account_id, sync_state.folder],
          set: { uid_validity: validity, last_uid: lastUid, updated_at: /* @__PURE__ */ new Date() }
        });
      };
      if (total === 0) {
        await saveState(Math.max(0, uidNext - 1));
        continue;
      }
      const lock = await client.getMailboxLock(folder.path, { readOnly: true });
      try {
        const wantBackfill = folder.kind === "inbox" ? backfill : Math.min(20, backfill);
        const metas = fresh ? await client.fetchAll(`${Math.max(1, total - wantBackfill + 1)}:*`, { uid: true, flags: true, size: true }) : await client.fetchAll(`${prev.last_uid + 1}:*`, { uid: true, flags: true, size: true }, { uid: true });
        const floor = fresh ? 0 : prev.last_uid;
        const pending = metas.filter((m) => m.uid > floor).sort((a, b) => a.uid - b.uid);
        let lastUid = floor;
        for (let i = 0; i < pending.length; i += 20) {
          if (Date.now() > deadline) {
            partial = true;
            break;
          }
          const batch = pending.slice(i, i + 20);
          const full = await client.fetchAll(
            batch.map((m) => m.uid).join(","),
            { uid: true, flags: true, source: { maxLength: MAX_SOURCE_BYTES }, internalDate: true },
            { uid: true }
          );
          full.sort((a, b) => a.uid - b.uid);
          for (const msg of full) {
            if (!msg.source) {
              lastUid = Math.max(lastUid, msg.uid);
              continue;
            }
            try {
              const rec = await buildRecord({
                account,
                selfAddress,
                folder,
                validity,
                uid: msg.uid,
                source: msg.source,
                flags: msg.flags,
                internalDate: msg.internalDate,
                routing: opts.routing
              });
              if (await storeEmail(rec)) {
                imported++;
                if (rec.direction === "inbound") newIds.push(rec.id);
                if (!fresh && rec.requires_alert && !rec.is_read && rec.direction === "inbound") {
                  void pushAlert({ subject: rec.subject, sender: rec.sender, summary: rec.ai_summary, account: selfAddress });
                }
              }
            } catch (msgErr) {
              console.warn(`[IMAP ${selfAddress}] skipped uid ${msg.uid} in ${folder.path}:`, msgErr.message);
            }
            lastUid = Math.max(lastUid, msg.uid);
          }
          await saveState(lastUid);
        }
        if (!partial && pending.length === 0) await saveState(Math.max(floor, uidNext - 1));
      } finally {
        lock.release();
      }
    }
    return { success: true, imported, newIds, partial };
  } catch (err) {
    const message = describeImapError(err);
    console.error(`[IMAP ${selfAddress}] sync failed:`, message);
    return { success: false, imported, newIds, error: message };
  } finally {
    await closeQuietly(client);
  }
}
async function buildRecord(input) {
  const parsed = await simpleParser(input.source, { skipImageLinks: true });
  const messageId = parsed.messageId?.trim() || null;
  const id = messageId || `imap:${input.account.id}:${input.folder.path}:${input.validity}:${input.uid}`;
  const fromAddrs = addressList(parsed.from);
  const toAddrs = addressList(parsed.to);
  const ccAddrs = addressList(parsed.cc);
  const envelopeRcpts = ["delivered-to", "x-original-to", "x-forwarded-to", "envelope-to"].map((h) => headerText(parsed, h).toLowerCase()).join(" ").match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ?? [];
  const outbound = input.folder.kind === "sent" || fromAddrs.includes(input.selfAddress);
  let accountId = input.account.id;
  const addressedHere = [...envelopeRcpts, ...toAddrs, ...ccAddrs].includes(input.selfAddress);
  if (!outbound && !addressedHere && input.routing) {
    for (const addr of [...envelopeRcpts, ...toAddrs, ...ccAddrs]) {
      const target = input.routing.get(addr);
      if (target && target !== input.account.id) {
        accountId = target;
        break;
      }
    }
  }
  const subject = parsed.subject?.trim() || "(No Subject)";
  const sender = parsed.from?.text || input.selfAddress;
  const text2 = parsed.text || (typeof parsed.html === "string" ? parsed.html.replace(/<style[\s\S]*?<\/style>|<[^>]+>/gi, " ") : "");
  const snippet = text2.replace(/\s+/g, " ").trim().slice(0, 200);
  const html = typeof parsed.html === "string" && parsed.html ? parsed.html : parsed.textAsHtml || text2;
  const cls = heuristicClassify({ subject, sender, text: text2, folderKind: input.folder.kind });
  const refs = Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : [];
  const threadRoot = refs[0] || parsed.inReplyTo || messageId || id;
  const received = parsed.date && !isNaN(parsed.date.getTime()) ? parsed.date : input.internalDate ? new Date(input.internalDate) : /* @__PURE__ */ new Date();
  return {
    id,
    account_id: accountId,
    thread_id: threadRoot,
    subject,
    sender,
    body_snippet: snippet,
    full_body: html.length > MAX_BODY_CHARS ? html.slice(0, MAX_BODY_CHARS) : html,
    category: outbound ? "work" : cls.category,
    ai_summary: snippet.slice(0, 160) || `Message from ${sender}: ${subject}`,
    requires_alert: outbound ? false : cls.requires_alert,
    is_read: outbound || Boolean(input.flags?.has("\\Seen")),
    received_at: received,
    message_id: messageId,
    recipients: [...toAddrs, ...ccAddrs].join(", ") || null,
    direction: outbound ? "outbound" : "inbound",
    folder: input.folder.path,
    has_attachments: parsed.attachments.some((a) => a.contentDisposition !== "inline")
  };
}
async function resetSyncState(accountId, folder) {
  await db.delete(sync_state).where(folder ? and2(eq5(sync_state.account_id, accountId), eq5(sync_state.folder, folder)) : eq5(sync_state.account_id, accountId));
}
var PROVIDERS, addressList, headerText, MAX_BODY_CHARS, MAX_SOURCE_BYTES;
var init_imap_sync = __esm({
  "src/lib/imap-sync.ts"() {
    init_db();
    init_schema();
    init_classify();
    init_secrets();
    init_notify();
    init_store_email();
    PROVIDERS = {
      "gmail.com": { host: "imap.gmail.com", port: 993, provider: "google", spamFolder: "[Gmail]/Spam" },
      "googlemail.com": { host: "imap.gmail.com", port: 993, provider: "google", spamFolder: "[Gmail]/Spam" },
      "zoho.com": { host: "imap.zoho.com", port: 993, provider: "zoho", spamFolder: "Spam" },
      "zohomail.com": { host: "imap.zoho.com", port: 993, provider: "zoho", spamFolder: "Spam" },
      "outlook.com": { host: "outlook.office365.com", port: 993, provider: "microsoft", spamFolder: "Junk Email" },
      "hotmail.com": { host: "outlook.office365.com", port: 993, provider: "microsoft", spamFolder: "Junk Email" },
      "live.com": { host: "outlook.office365.com", port: 993, provider: "microsoft", spamFolder: "Junk Email" }
    };
    addressList = (field) => {
      if (!field) return [];
      const list = Array.isArray(field) ? field : [field];
      return list.flatMap((a) => a.value.map((v) => v.address?.toLowerCase()).filter((x) => !!x));
    };
    headerText = (parsed, name) => {
      const v = parsed.headers.get(name);
      if (!v) return "";
      if (typeof v === "string") return v;
      if (Array.isArray(v)) return v.join(" ");
      if (typeof v === "object" && "text" in v) return String(v.text);
      return String(v);
    };
    MAX_BODY_CHARS = 1e6;
    MAX_SOURCE_BYTES = 12 * 1024 * 1024;
  }
});

// src/lib/sync-runner.ts
import { eq as eq6, inArray as inArray2, sql } from "drizzle-orm";
function envPasswords() {
  const map = /* @__PURE__ */ new Map();
  const add = (user, pass) => {
    if (user?.trim() && pass?.trim()) map.set(user.trim().toLowerCase(), pass.trim());
  };
  add(process.env.GMAIL_USER, process.env.GMAIL_APP_PASSWORD);
  add(process.env.BACKUPE9_USER, process.env.BACKUPE9_APP_PASSWORD);
  add(process.env.AETHERMAIL_SENDER, process.env.IMAP_PASSWORD);
  return map;
}
function passwordFor(acc, env = envPasswords()) {
  return mailboxPassword(acc.oauth_tokens) || env.get(acc.email_address.trim().toLowerCase()) || "";
}
async function routingMap() {
  const rows = await db.select({ id: accounts.id, email: accounts.email_address }).from(accounts);
  return new Map(rows.map((r) => [r.email.trim().toLowerCase(), r.id]));
}
async function acquireLease(accountId, force) {
  const res = await db.execute(sql`
    UPDATE accounts
       SET sync_lease_until = now() + (${LEASE_SECONDS} * interval '1 second'), sync_status = 'syncing'
     WHERE id = ${accountId}
       AND (sync_lease_until IS NULL OR sync_lease_until < now())
       AND (${force} OR last_synced_at IS NULL OR last_synced_at < now() - (${MIN_INTERVAL_MS} * interval '1 millisecond'))
     RETURNING id`);
  if (res.rows.length > 0) return "ok";
  const [row] = await db.select({ lease: accounts.sync_lease_until }).from(accounts).where(eq6(accounts.id, accountId));
  return row?.lease && row.lease > /* @__PURE__ */ new Date() ? "busy" : "fresh";
}
async function syncOneAccount(acc, opts = {}) {
  const base = { accountId: acc.id, email: acc.email_address };
  const password = passwordFor(acc, opts.env);
  if (!password && acc.provider === "resend") {
    if (acc.last_sync_error || acc.sync_status !== "synced") {
      await db.update(accounts).set({ sync_status: "synced", last_sync_error: null }).where(eq6(accounts.id, acc.id));
    }
    return { ...base, status: "skipped", imported: 0 };
  }
  if (!password) {
    await db.update(accounts).set({ sync_status: "error", last_sync_error: "No mailbox password saved. Reconnect this mailbox to resume syncing." }).where(eq6(accounts.id, acc.id));
    return { ...base, status: "no-credentials", imported: 0, error: "No mailbox password saved" };
  }
  const lease = await acquireLease(acc.id, Boolean(opts.force));
  if (lease !== "ok") return { ...base, status: lease === "busy" ? "busy" : "skipped", imported: 0 };
  let result;
  try {
    result = await syncMailbox(acc, password, {
      deadline: opts.deadline,
      routing: opts.routing ?? await routingMap()
    });
  } catch (err) {
    result = { success: false, imported: 0, error: err.message };
  }
  await db.update(accounts).set({
    sync_status: result.success ? "synced" : "error",
    last_sync_error: result.success ? null : result.error ?? "Unknown sync error",
    last_synced_at: result.success ? /* @__PURE__ */ new Date() : acc.last_synced_at,
    sync_lease_until: null
  }).where(eq6(accounts.id, acc.id));
  if (result.newIds?.length) {
    await refineWithAi(result.newIds, opts.deadline);
  }
  return {
    ...base,
    status: result.success ? "ok" : "error",
    imported: result.imported,
    error: result.error,
    partial: result.partial
  };
}
async function syncAllAccounts(opts = {}) {
  const started = Date.now();
  const deadline = started + (opts.budgetMs ?? 45e3);
  const all = await db.select().from(accounts);
  const routing = new Map(all.map((a) => [a.email_address.trim().toLowerCase(), a.id]));
  const env = envPasswords();
  const reports = await mapLimit(
    all,
    4,
    (acc) => syncOneAccount(acc, { force: opts.force, deadline, routing, env }).catch(
      (err) => ({ accountId: acc.id, email: acc.email_address, status: "error", imported: 0, error: err.message })
    )
  );
  return {
    success: true,
    imported: reports.reduce((n, r) => n + r.imported, 0),
    reports,
    durationMs: Date.now() - started,
    syncedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
async function refineWithAi(ids, deadline) {
  if (!isAiConfigured()) return;
  const cap = Number(process.env.AI_CLASSIFY_PER_SYNC) || 8;
  const rows = await db.select({ id: emails.id, subject: emails.subject, sender: emails.sender, body: emails.body_snippet, full: emails.full_body, category: emails.category }).from(emails).where(inArray2(emails.id, ids.slice(-cap)));
  await mapLimit(rows, 3, async (row) => {
    if (row.category === "spam") return;
    if (deadline && Date.now() > deadline - 3e3) return;
    try {
      const text2 = row.full.replace(/<style[\s\S]*?<\/style>|<[^>]+>/gi, " ").replace(/\s+/g, " ").slice(0, 6e3);
      const ai = await classifyWithAi({ subject: row.subject, sender: row.sender, body: text2 || row.body });
      if (!ai) return;
      await db.update(emails).set({ category: ai.category, ai_summary: ai.summary, requires_alert: ai.requires_alert }).where(eq6(emails.id, row.id));
    } catch (err) {
      console.warn("[sync] AI refinement skipped:", err.message);
    }
  });
}
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}
function startBackgroundSync() {
  const intervalMs = (Number(process.env.SYNC_INTERVAL_SECONDS) || 60) * 1e3;
  const watchers = /* @__PURE__ */ new Map();
  const tick = async () => {
    try {
      const res = await syncAllAccounts({ budgetMs: Math.max(2e4, intervalMs - 5e3) });
      if (res.imported > 0) console.log(`[sync] imported ${res.imported} message(s) in ${res.durationMs}ms`);
      await refreshWatchers();
    } catch (err) {
      console.warn("[sync] background sync failed:", err.message);
    }
  };
  const refreshWatchers = async () => {
    if (process.env.IMAP_IDLE === "false") return;
    const all = await db.select().from(accounts);
    const env = envPasswords();
    for (const acc of all) {
      if (watchers.has(acc.id)) continue;
      const password = passwordFor(acc, env);
      if (!password) continue;
      watchers.set(acc.id, watchInbox(acc, password));
    }
    for (const [id, w] of watchers) {
      if (!all.some((a) => a.id === id)) {
        w.stop();
        watchers.delete(id);
      }
    }
  };
  void tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  console.log(`[sync] background sync every ${intervalMs / 1e3}s with IMAP IDLE push`);
}
function watchInbox(acc, password) {
  let stopped = false;
  let client = null;
  let debounce = null;
  let backoff = 5e3;
  const trigger = () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(async () => {
      const [fresh] = await db.select().from(accounts).where(eq6(accounts.id, acc.id));
      if (fresh) {
        const r = await syncOneAccount(fresh, { force: true }).catch(() => null);
        if (r?.imported) console.log(`[idle] ${acc.email_address}: +${r.imported}`);
      }
    }, 1500);
  };
  const connect = async () => {
    if (stopped) return;
    try {
      const target = resolveImapProvider(acc.email_address, readMailboxConfig(acc.oauth_tokens));
      client = createImapClient(acc.email_address, password, target);
      client.on("exists", trigger);
      client.on("error", () => {
      });
      client.on("close", () => {
        if (!stopped) setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 5 * 6e4);
      });
      await client.connect();
      await client.mailboxOpen("INBOX", { readOnly: true });
      backoff = 5e3;
    } catch (err) {
      console.warn(`[idle] ${acc.email_address}: ${err.message}`);
      try {
        client?.close();
      } catch {
      }
    }
  };
  void connect();
  return {
    stop: () => {
      stopped = true;
      if (debounce) clearTimeout(debounce);
      try {
        client?.close();
      } catch {
      }
    }
  };
}
var MIN_INTERVAL_MS, LEASE_SECONDS;
var init_sync_runner = __esm({
  "src/lib/sync-runner.ts"() {
    init_db();
    init_schema();
    init_secrets();
    init_imap_sync();
    init_secrets();
    init_gemini();
    MIN_INTERVAL_MS = 15e3;
    LEASE_SECONDS = 120;
  }
});

// src/lib/mailbox-service.ts
var mailbox_service_exports = {};
__export(mailbox_service_exports, {
  connectMailbox: () => connectMailbox
});
import { eq as eq7 } from "drizzle-orm";
async function connectMailbox(input) {
  const email = input.email_address.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
  const password = input.password.replace(/\s+/g, "");
  if (!password) throw new Error("A mailbox password (app password) is required.");
  const [existing] = await db.select().from(accounts).where(eq7(accounts.email_address, email)).limit(1);
  const prevCfg = existing ? readMailboxConfig(existing.oauth_tokens) : {};
  const cfg = {
    ...input.imap_host?.trim() ? { imap_host: input.imap_host.trim(), imap_port: Number(input.imap_port) || 993 } : {
      imap_host: prevCfg.imap_host,
      imap_port: prevCfg.imap_port
    },
    ...input.smtp_host?.trim() ? { smtp_host: input.smtp_host.trim(), smtp_port: Number(input.smtp_port) || 465 } : {
      smtp_host: prevCfg.smtp_host,
      smtp_port: prevCfg.smtp_port
    }
  };
  const probe = await testImapLogin(email, password, cfg);
  if (!probe.ok) throw new Error(`${probe.host}: ${probe.error}`);
  const target = resolveImapProvider(email, cfg);
  const sealed = { ...cfg, imap_host: cfg.imap_host || target.host, imap_port: cfg.imap_port || target.port, secret: encryptSecret(password) };
  let account;
  if (existing) {
    [account] = await db.update(accounts).set({
      oauth_tokens: sealed,
      provider: target.provider,
      display_name: input.display_name?.trim() || existing.display_name,
      sync_status: "synced",
      last_sync_error: null
    }).where(eq7(accounts.id, existing.id)).returning();
  } else {
    [account] = await db.insert(accounts).values({
      id: `acc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      provider: target.provider,
      email_address: email,
      oauth_tokens: sealed,
      display_name: input.display_name?.trim() || null,
      sync_status: "synced"
    }).returning();
  }
  const report = input.initialSync === false ? null : await syncOneAccount(account, { force: true, deadline: Date.now() + 4e4 });
  return { account, folders: probe.folders, report };
}
var init_mailbox_service = __esm({
  "src/lib/mailbox-service.ts"() {
    init_db();
    init_schema();
    init_secrets();
    init_imap_sync();
    init_sync_runner();
  }
});

// src/lib/resend-inbound.ts
var resend_inbound_exports = {};
__export(resend_inbound_exports, {
  ingestResendEvent: () => ingestResendEvent,
  verifySvixSignature: () => verifySvixSignature
});
import crypto8 from "node:crypto";
import { eq as eq9 } from "drizzle-orm";
function verifySvixSignature(rawBody, headers, secret) {
  const id = String(headers["svix-id"] ?? "");
  const ts = String(headers["svix-timestamp"] ?? "");
  const sigHeader = String(headers["svix-signature"] ?? "");
  if (!id || !ts || !sigHeader) return false;
  const age = Math.abs(Date.now() / 1e3 - Number(ts));
  if (!Number.isFinite(age) || age > 300) return false;
  const key2 = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  const expected = crypto8.createHmac("sha256", key2).update(`${id}.${ts}.${rawBody}`).digest("base64");
  return sigHeader.split(" ").some((part) => {
    const [, sig] = part.split(",");
    if (!sig) return false;
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto8.timingSafeEqual(a, b);
  });
}
async function fetchReceived(emailId) {
  const key2 = process.env.RESEND_API_KEY?.trim();
  if (!key2) return null;
  try {
    const base = (process.env.RESEND_API_URL?.trim() || "https://api.resend.com").replace(/\/$/, "");
    const res = await fetch(`${base}/emails/receiving/${encodeURIComponent(emailId)}`, {
      headers: { Authorization: `Bearer ${key2}` },
      signal: AbortSignal.timeout(1e4)
    });
    if (!res.ok) {
      console.warn(`[resend-inbound] fetch ${emailId} \u2192 HTTP ${res.status} (a send-only API key cannot read received mail)`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn("[resend-inbound] fetch failed:", err.message);
    return null;
  }
}
async function ingestResendEvent(event) {
  if (event.type !== "email.received" || !event.data) return { stored: 0, ignored: event.type ?? "unknown" };
  const meta = event.data;
  const resendId = meta.email_id || meta.id || "";
  const full = (meta.html || meta.text ? meta : null) ?? (resendId ? await fetchReceived(resendId) : null);
  const msg = { ...meta, ...full ?? {} };
  const recipients = [...toArray(msg.to), ...toArray(msg.cc)].map(bareAddress);
  const domain = businessDomain();
  let stored = 0;
  const targets = recipients.filter((r) => !domain || r.endsWith(`@${domain}`));
  for (const rcpt of targets.length ? targets : recipients.slice(0, 1)) {
    let [acc] = await db.select().from(accounts).where(eq9(accounts.email_address, rcpt)).limit(1);
    if (!acc) {
      [acc] = await db.insert(accounts).values({ id: `acc_rs_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, provider: "resend", email_address: rcpt, sync_status: "synced" }).onConflictDoNothing().returning();
      if (!acc) [acc] = await db.select().from(accounts).where(eq9(accounts.email_address, rcpt)).limit(1);
    }
    const sender = msg.from || "unknown sender";
    const subject = msg.subject?.trim() || "(No Subject)";
    const text2 = msg.text || (msg.html ? msg.html.replace(/<style[\s\S]*?<\/style>|<[^>]+>/gi, " ") : "");
    const snippet = text2.replace(/\s+/g, " ").trim().slice(0, 200);
    const cls = heuristicClassify({ subject, sender, text: text2 });
    const id = msg.message_id || `resend:${resendId}`;
    const row = {
      id,
      account_id: acc.id,
      thread_id: msg.message_id || id,
      subject,
      sender,
      body_snippet: snippet,
      full_body: msg.html || (text2 ? `<pre style="white-space:pre-wrap;font-family:inherit">${text2.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c])}</pre>` : full ? "" : "<p><em>Body not retrieved: set a RESEND_API_KEY with full access so AetherMail can fetch received mail.</em></p>"),
      category: cls.category,
      ai_summary: snippet.slice(0, 160) || subject,
      requires_alert: cls.requires_alert,
      is_read: false,
      received_at: msg.created_at ? new Date(msg.created_at) : /* @__PURE__ */ new Date(),
      message_id: msg.message_id ?? null,
      recipients: recipients.join(", "),
      direction: "inbound",
      folder: "INBOX",
      has_attachments: Array.isArray(msg.attachments) && msg.attachments.length > 0
    };
    if (await storeEmail(row)) {
      stored++;
      if (row.requires_alert) void pushAlert({ subject, sender, summary: row.ai_summary, account: rcpt });
    }
  }
  return { stored };
}
var toArray, bareAddress;
var init_resend_inbound = __esm({
  "src/lib/resend-inbound.ts"() {
    init_db();
    init_schema();
    init_classify();
    init_notify();
    init_store_email();
    init_business_mailboxes();
    toArray = (v) => Array.isArray(v) ? v : v ? [v] : [];
    bareAddress = (s) => (s.match(/<([^>]+)>/)?.[1] ?? s).trim().toLowerCase();
  }
});

// server.ts
init_db();
import express from "express";
import path from "path";
import { and as and4, desc as desc3, eq as eq10, ilike as ilike2, lt, or as or3, sql as sql3 } from "drizzle-orm";

// src/db/ensure-schema.ts
init_db();
var DDL = `
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
var ready = null;
function ensureSchema() {
  if (!ready) {
    ready = pool.query(DDL).then(
      async () => {
        const { ensureBusinessMailboxes: ensureBusinessMailboxes2 } = await Promise.resolve().then(() => (init_business_mailboxes(), business_mailboxes_exports));
        await ensureBusinessMailboxes2().catch((err) => console.warn("[schema] business mailboxes not seeded:", err.message));
      },
      (err) => {
        ready = null;
        throw err;
      }
    );
  }
  return ready;
}

// server.ts
init_schema();
init_gemini();

// src/app/actions/send-email.ts
init_db();
init_schema();
init_secrets();
init_store_email();
import crypto2 from "node:crypto";
import nodemailer from "nodemailer";
import { eq, or } from "drizzle-orm";
var EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
var cleanEmailList = (raw) => {
  if (!raw) return [];
  const parts = Array.isArray(raw) ? raw : raw.split(/[,;\n]+/);
  return parts.map((r) => {
    const t = r.trim();
    const angle = t.match(/<([^>]+)>/);
    return (angle ? angle[1] : t).trim();
  }).filter((r) => EMAIL_RE.test(r));
};
var htmlToText = (html) => html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\n{3,}/g, "\n\n").trim();
function gmailPasswords() {
  const map = /* @__PURE__ */ new Map();
  const add = (u, p) => {
    if (u?.trim() && p?.trim()) map.set(u.trim().toLowerCase(), p.trim());
  };
  add(process.env.GMAIL_USER, process.env.GMAIL_APP_PASSWORD);
  add(process.env.BACKUPE9_USER, process.env.BACKUPE9_APP_PASSWORD);
  return map;
}
var isGmail = (addr) => /@(gmail|googlemail)\.com$/i.test(addr);
function mailboxSmtp(acc) {
  if (!acc) return null;
  const cfg = readMailboxConfig(acc.oauth_tokens);
  if (cfg.smtp_host) return { host: cfg.smtp_host, port: cfg.smtp_port || 465 };
  const imap = cfg.imap_host || "";
  if (imap.includes("zoho")) return { host: imap.replace("imap", "smtp"), port: 465 };
  if (imap.includes("office365") || imap.includes("outlook")) return { host: "smtp.office365.com", port: 587 };
  return null;
}
async function viaSmtp(env, server, overrides = {}) {
  const isLocal = /^(localhost|127\.|::1|0\.0\.0\.0)/.test(server.host);
  const transporter = nodemailer.createTransport({
    host: server.host,
    port: server.port,
    secure: server.port === 465,
    ...server.user ? { auth: { user: server.user, pass: server.pass } } : {},
    tls: { rejectUnauthorized: !isLocal },
    connectionTimeout: 15e3,
    greetingTimeout: 1e4,
    socketTimeout: 3e4
  });
  const info = await transporter.sendMail({
    from: overrides.from ?? `"${env.fromName}" <${env.from}>`,
    to: env.to,
    cc: env.cc.length ? env.cc : void 0,
    bcc: env.bcc.length ? env.bcc : void 0,
    replyTo: overrides.replyTo ?? env.replyTo,
    subject: env.subject,
    html: env.html,
    text: env.text,
    messageId: env.messageId,
    headers: env.headers,
    attachments: env.attachments.map((a) => ({
      filename: a.filename,
      content: Buffer.from(a.content, "base64"),
      contentType: a.contentType
    }))
  });
  return info.messageId || env.messageId;
}
var resendBase = () => (process.env.RESEND_API_URL?.trim() || "https://api.resend.com").replace(/\/$/, "");
async function viaResend(env) {
  const key2 = process.env.RESEND_API_KEY?.trim();
  if (!key2) throw new Error("RESEND_API_KEY not set");
  const res = await fetch(`${resendBase()}/emails`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key2}`,
      "Content-Type": "application/json",
      "Idempotency-Key": env.messageId
    },
    body: JSON.stringify({
      from: `${env.fromName} <${env.from}>`,
      to: env.to,
      cc: env.cc.length ? env.cc : void 0,
      bcc: env.bcc.length ? env.bcc : void 0,
      reply_to: env.replyTo ? [env.replyTo] : void 0,
      subject: env.subject,
      html: env.html,
      text: env.text,
      headers: { ...env.headers, "Message-ID": env.messageId },
      attachments: env.attachments.length ? env.attachments.map((a) => ({ filename: a.filename, content: a.content, content_type: a.contentType })) : void 0
    }),
    signal: AbortSignal.timeout(2e4)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body.message || `HTTP ${res.status}`;
    if (/not verified|verify a domain|domain.*verif/i.test(msg)) {
      throw new Error(`${msg} \u2014 verify ${env.from.split("@")[1]} at resend.com/domains and add its DKIM record in Route 53.`);
    }
    if (res.status === 401 || res.status === 403) throw new Error(`Resend rejected the API key (${msg}).`);
    throw new Error(msg);
  }
  return env.messageId;
}
async function sendEmailAction(params) {
  const attempts = [];
  try {
    const toList = cleanEmailList(params.to);
    const ccList = cleanEmailList(params.cc);
    const bccList = cleanEmailList(params.bcc);
    if (!params.accountId || toList.length === 0 || !params.subject?.trim() || !params.htmlBody?.trim()) {
      return { success: false, error: "A sender, at least one valid recipient, a subject and a message are required." };
    }
    const [acc] = await db.select().from(accounts).where(or(eq(accounts.id, params.accountId), eq(accounts.email_address, params.accountId.toLowerCase()))).limit(1);
    const from = (acc?.email_address || params.accountId).trim().toLowerCase();
    if (!EMAIL_RE.test(from)) return { success: false, error: `Unknown sending account "${params.accountId}".` };
    const domain = from.split("@")[1];
    const businessName = process.env.BUSINESS_NAME?.trim();
    const fromName = params.fromName?.trim() || acc?.display_name || (isGmail(from) ? from.split("@")[0] : businessName || from.split("@")[0]);
    const headers = { "X-Mailer": "AetherMail/3.0" };
    let threadId = "";
    if (params.inReplyToId) {
      const [orig] = await db.select({ message_id: emails.message_id, id: emails.id, thread_id: emails.thread_id }).from(emails).where(eq(emails.id, params.inReplyToId)).limit(1);
      const ref = orig?.message_id || (orig?.id?.startsWith("<") ? orig.id : null);
      if (ref) {
        headers["In-Reply-To"] = ref;
        headers["References"] = orig.thread_id && orig.thread_id !== ref && orig.thread_id.startsWith("<") ? `${orig.thread_id} ${ref}` : ref;
      }
      threadId = orig?.thread_id || "";
    }
    const env = {
      from,
      fromName,
      to: toList,
      cc: ccList,
      bcc: bccList,
      subject: params.subject.trim(),
      html: params.htmlBody,
      text: htmlToText(params.htmlBody),
      messageId: `<${crypto2.randomUUID()}@${domain}>`,
      headers,
      attachments: params.attachments ?? []
    };
    const pass = acc ? mailboxPassword(acc.oauth_tokens) : "";
    const gmail = gmailPasswords();
    let provider = "";
    let messageId = "";
    const attempt = async (name, fn) => {
      if (provider) return;
      try {
        messageId = await fn();
        provider = name;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[send] ${name} failed:`, msg);
        attempts.push({ provider: name, error: msg });
      }
    };
    if (isGmail(from)) {
      const gpass = pass || gmail.get(from);
      if (gpass) await attempt("Gmail SMTP", () => viaSmtp(env, { host: "smtp.gmail.com", port: 465, user: from, pass: gpass }));
      else attempts.push({ provider: "Gmail SMTP", error: `No app password saved for ${from}` });
    } else {
      if (process.env.RESEND_API_KEY?.trim()) await attempt("Resend", () => viaResend(env));
      const own = mailboxSmtp(acc);
      if (own && pass) await attempt(`SMTP ${own.host}`, () => viaSmtp(env, { ...own, user: from, pass }));
      const relayHost = process.env.SMTP_HOST?.trim();
      if (relayHost && !(relayHost === "smtp.resend.com" && attempts.some((a) => a.provider === "Resend"))) {
        await attempt(
          `SMTP relay ${relayHost}`,
          () => viaSmtp(env, {
            host: relayHost,
            port: Number(process.env.SMTP_PORT) || 587,
            user: process.env.SMTP_USER?.trim() || void 0,
            pass: process.env.SMTP_PASS?.trim() || process.env.RESEND_API_KEY?.trim()
          })
        );
      }
      const relayUser = process.env.GMAIL_USER?.trim().toLowerCase();
      const relayPass = relayUser ? gmail.get(relayUser) : void 0;
      if (!provider && relayUser && relayPass && process.env.ALLOW_GMAIL_RELAY !== "false") {
        await attempt(
          `Gmail relay (${relayUser}, Reply-To ${from})`,
          () => viaSmtp(env, { host: "smtp.gmail.com", port: 465, user: relayUser, pass: relayPass }, {
            from: `"${fromName} (${from})" <${relayUser}>`,
            replyTo: from
          })
        );
      }
    }
    if (!provider) {
      const detail = attempts.length ? attempts.map((a) => `${a.provider}: ${a.error}`).join(" | ") : "No sending route is configured. Set RESEND_API_KEY (business domains) or save the mailbox password.";
      return { success: false, error: `Nothing was sent. ${detail}`, attempts };
    }
    try {
      const record = {
        id: messageId,
        account_id: acc?.id ?? params.accountId,
        thread_id: threadId || messageId,
        subject: env.subject,
        sender: `${fromName} <${from}>`,
        body_snippet: env.text.replace(/\s+/g, " ").slice(0, 200),
        full_body: env.html,
        category: "work",
        ai_summary: `Sent to ${toList.join(", ")}`,
        requires_alert: false,
        is_read: true,
        received_at: /* @__PURE__ */ new Date(),
        message_id: messageId,
        recipients: [...toList, ...ccList].join(", "),
        direction: "outbound",
        folder: "Sent",
        has_attachments: env.attachments.length > 0
      };
      if (acc) await storeEmail(record);
    } catch (dbErr) {
      console.warn("[send] sent, but could not log the copy:", dbErr);
    }
    return {
      success: true,
      messageId,
      dispatchedAt: (/* @__PURE__ */ new Date()).toISOString(),
      provider,
      attempts: attempts.length ? attempts : void 0
    };
  } catch (err) {
    console.error("sendEmailAction error:", err);
    return { success: false, error: err instanceof Error ? err.message : "Failed to send", attempts };
  }
}

// src/app/actions/smart-search.ts
init_db();
init_schema();
init_gemini();
import { eq as eq2, and, or as or2, ilike, gte, desc } from "drizzle-orm";
import { Type as Type2 } from "@google/genai";
async function smartSearchAction(query, accountId) {
  try {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      const results = await db.select({
        id: emails.id,
        account_id: emails.account_id,
        thread_id: emails.thread_id,
        subject: emails.subject,
        sender: emails.sender,
        body_snippet: emails.body_snippet,
        full_body: emails.full_body,
        category: emails.category,
        ai_summary: emails.ai_summary,
        requires_alert: emails.requires_alert,
        is_read: emails.is_read,
        received_at: emails.received_at,
        account_email: accounts.email_address
      }).from(emails).leftJoin(accounts, eq2(emails.account_id, accounts.id)).orderBy(desc(emails.received_at)).limit(50);
      return {
        success: true,
        emails: results.map((r) => ({
          ...r,
          received_at: r.received_at ? r.received_at.toISOString() : (/* @__PURE__ */ new Date()).toISOString()
        }))
      };
    }
    const ai = getGeminiClient();
    const prompt = `You are an expert search parser for an email intelligence system.
Parse the user's natural language search query into structured search filters.
The current date is September 16, 2026.

User Query: "${trimmedQuery}"

Extract the following fields:
- "category": null OR strictly one of: 'urgent', 'personal', 'newsletter', 'automated', 'work', 'financial'
- "requires_alert": true if query asks for alerts/emergencies/urgent action items, false if it specifies non-alerts, or null if neutral.
- "keywords": list of specific content keywords, topics, or nouns mentioned (e.g. ["server", "latency"] or ["term sheet", "valuation"]).
- "sender": name or email domain of sender if specified, otherwise null.
- "days_ago": number of days back if query mentions relative time (e.g. "yesterday" = 2, "past week" = 7, "today" = 1), otherwise null.
- "intent_explanation": 1 concise sentence explaining what you understood.`;
    let parsedIntent = {
      category: null,
      requires_alert: null,
      keywords: [trimmedQuery],
      sender: null,
      days_ago: null,
      intent_explanation: `Searching for "${trimmedQuery}"`
    };
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type2.OBJECT,
            properties: {
              category: {
                type: Type2.STRING,
                enum: ["urgent", "personal", "newsletter", "automated", "work", "financial", "null"]
              },
              requires_alert: {
                type: Type2.BOOLEAN,
                nullable: true
              },
              keywords: {
                type: Type2.ARRAY,
                items: { type: Type2.STRING }
              },
              sender: {
                type: Type2.STRING,
                nullable: true
              },
              days_ago: {
                type: Type2.INTEGER,
                nullable: true
              },
              intent_explanation: {
                type: Type2.STRING
              }
            },
            required: ["intent_explanation"]
          }
        }
      });
      const responseText = response.text;
      if (responseText) {
        const rawJson = JSON.parse(responseText);
        parsedIntent = {
          category: rawJson.category === "null" || !rawJson.category ? null : rawJson.category,
          requires_alert: typeof rawJson.requires_alert === "boolean" ? rawJson.requires_alert : null,
          keywords: Array.isArray(rawJson.keywords) && rawJson.keywords.length > 0 ? rawJson.keywords : [trimmedQuery],
          sender: rawJson.sender || null,
          days_ago: typeof rawJson.days_ago === "number" ? rawJson.days_ago : null,
          intent_explanation: rawJson.intent_explanation || `Searching for ${trimmedQuery}`
        };
      }
    } catch (parseErr) {
      console.warn("Gemini intent extraction fallback:", parseErr);
      const lower = trimmedQuery.toLowerCase();
      if (lower.includes("urgent") || lower.includes("alert")) {
        parsedIntent.requires_alert = true;
      }
      if (lower.includes("financial") || lower.includes("invoice")) {
        parsedIntent.category = "financial";
      }
    }
    const conditions = [];
    if (accountId && accountId !== "all") {
      conditions.push(eq2(emails.account_id, accountId));
    }
    if (parsedIntent.category) {
      conditions.push(eq2(emails.category, parsedIntent.category));
    }
    if (parsedIntent.requires_alert !== null) {
      conditions.push(eq2(emails.requires_alert, parsedIntent.requires_alert));
    }
    if (parsedIntent.sender) {
      conditions.push(ilike(emails.sender, `%${parsedIntent.sender}%`));
    }
    if (parsedIntent.days_ago && parsedIntent.days_ago > 0) {
      const cutoff = new Date(Date.now() - parsedIntent.days_ago * 24 * 60 * 60 * 1e3);
      conditions.push(gte(emails.received_at, cutoff));
    }
    if (parsedIntent.keywords.length > 0) {
      const keywordFilters = parsedIntent.keywords.map(
        (kw) => or2(
          ilike(emails.subject, `%${kw}%`),
          ilike(emails.ai_summary, `%${kw}%`),
          ilike(emails.full_body, `%${kw}%`),
          ilike(emails.sender, `%${kw}%`)
        )
      );
      conditions.push(or2(...keywordFilters));
    }
    const queryBuilder = db.select({
      id: emails.id,
      account_id: emails.account_id,
      thread_id: emails.thread_id,
      subject: emails.subject,
      sender: emails.sender,
      body_snippet: emails.body_snippet,
      full_body: emails.full_body,
      category: emails.category,
      ai_summary: emails.ai_summary,
      requires_alert: emails.requires_alert,
      is_read: emails.is_read,
      received_at: emails.received_at,
      account_email: accounts.email_address
    }).from(emails).leftJoin(accounts, eq2(emails.account_id, accounts.id)).orderBy(desc(emails.received_at)).limit(50);
    const rows = conditions.length > 0 ? await queryBuilder.where(and(...conditions)) : await queryBuilder;
    let finalRows = rows;
    if (finalRows.length === 0) {
      const relaxedConditions = [];
      if (accountId && accountId !== "all") {
        relaxedConditions.push(eq2(emails.account_id, accountId));
      }
      if (parsedIntent.category) {
        relaxedConditions.push(eq2(emails.category, parsedIntent.category));
      }
      if (parsedIntent.requires_alert !== null) {
        relaxedConditions.push(eq2(emails.requires_alert, parsedIntent.requires_alert));
      }
      if (relaxedConditions.length > 0) {
        const relaxedRows = await db.select({
          id: emails.id,
          account_id: emails.account_id,
          thread_id: emails.thread_id,
          subject: emails.subject,
          sender: emails.sender,
          body_snippet: emails.body_snippet,
          full_body: emails.full_body,
          category: emails.category,
          ai_summary: emails.ai_summary,
          requires_alert: emails.requires_alert,
          is_read: emails.is_read,
          received_at: emails.received_at,
          account_email: accounts.email_address
        }).from(emails).leftJoin(accounts, eq2(emails.account_id, accounts.id)).where(and(...relaxedConditions)).orderBy(desc(emails.received_at)).limit(30);
        if (relaxedRows.length > 0) {
          finalRows = relaxedRows;
        }
      }
    }
    if (finalRows.length === 0 && trimmedQuery) {
      const words = trimmedQuery.split(/\s+/).filter((w) => w.length > 2 && !["the", "and", "for", "from", "with", "about", "find"].includes(w.toLowerCase()));
      const wordFilters = words.map(
        (w) => or2(
          ilike(emails.subject, `%${w}%`),
          ilike(emails.ai_summary, `%${w}%`),
          ilike(emails.full_body, `%${w}%`),
          ilike(emails.sender, `%${w}%`)
        )
      );
      if (wordFilters.length > 0) {
        const tokenRows = await db.select({
          id: emails.id,
          account_id: emails.account_id,
          thread_id: emails.thread_id,
          subject: emails.subject,
          sender: emails.sender,
          body_snippet: emails.body_snippet,
          full_body: emails.full_body,
          category: emails.category,
          ai_summary: emails.ai_summary,
          requires_alert: emails.requires_alert,
          is_read: emails.is_read,
          received_at: emails.received_at,
          account_email: accounts.email_address
        }).from(emails).leftJoin(accounts, eq2(emails.account_id, accounts.id)).where(or2(...wordFilters)).orderBy(desc(emails.received_at)).limit(30);
        if (tokenRows.length > 0) {
          finalRows = tokenRows;
        }
      }
    }
    return {
      success: true,
      emails: finalRows.map((r) => ({
        ...r,
        received_at: r.received_at ? r.received_at.toISOString() : (/* @__PURE__ */ new Date()).toISOString()
      })),
      parsedIntent
    };
  } catch (error) {
    console.error("smartSearchAction error:", error);
    return {
      success: false,
      emails: [],
      error: error instanceof Error ? error.message : "Search failed"
    };
  }
}

// src/app/actions/batch-emails.ts
init_db();
init_schema();
import { inArray } from "drizzle-orm";
async function batchUpdateEmailsAction(params) {
  try {
    const { emailIds, action } = params;
    if (!Array.isArray(emailIds) || emailIds.length === 0) {
      return {
        success: false,
        affectedCount: 0,
        action,
        error: "No email IDs provided for batch operation."
      };
    }
    if (action === "mark_read") {
      const result = await db.update(emails).set({ is_read: true }).where(inArray(emails.id, emailIds)).returning();
      return {
        success: true,
        affectedCount: result.length,
        action: "mark_read"
      };
    }
    if (action === "mark_unread") {
      const result = await db.update(emails).set({ is_read: false }).where(inArray(emails.id, emailIds)).returning();
      return {
        success: true,
        affectedCount: result.length,
        action: "mark_unread"
      };
    }
    if (action === "delete") {
      const result = await db.delete(emails).where(inArray(emails.id, emailIds)).returning();
      return {
        success: true,
        affectedCount: result.length,
        action: "delete"
      };
    }
    return {
      success: false,
      affectedCount: 0,
      action,
      error: `Unknown batch action: "${action}"`
    };
  } catch (error) {
    console.error("batchUpdateEmailsAction error:", error);
    return {
      success: false,
      affectedCount: 0,
      action: params.action,
      error: error instanceof Error ? error.message : "Failed to execute batch operation"
    };
  }
}

// src/server/v1-router.ts
init_db();
init_schema();
import { Router } from "express";
import crypto7 from "node:crypto";
import { eq as eq8, and as and3, desc as desc2, gte as gte2, sql as sql2 } from "drizzle-orm";

// src/lib/api-auth.ts
init_db();
init_schema();
import crypto3 from "node:crypto";
import { eq as eq3 } from "drizzle-orm";
function hashApiKey(rawKey) {
  return crypto3.createHash("sha256").update(rawKey.trim()).digest("hex");
}
function generateNewApiKey(name, scopes = ["read"]) {
  const id = `key_${Date.now()}_${crypto3.randomBytes(4).toString("hex")}`;
  const entropy = crypto3.randomBytes(24).toString("base64url");
  const rawKey = `ops_${entropy}`;
  const prefix = `ops_${entropy.slice(0, 6)}...${entropy.slice(-4)}`;
  const keyHash = hashApiKey(rawKey);
  return {
    id,
    name,
    rawKey,
    prefix,
    keyHash,
    scopes
  };
}
function extractTokenFromRequest(req) {
  let authHeader = null;
  let xApiKey = null;
  if ("headers" in req) {
    if (typeof req.headers.get === "function") {
      authHeader = req.headers.get("authorization");
      xApiKey = req.headers.get("x-api-key");
    } else {
      const headers = req.headers;
      const rawAuth = headers["authorization"];
      authHeader = Array.isArray(rawAuth) ? rawAuth[0] : rawAuth || null;
      const rawX = headers["x-api-key"];
      xApiKey = Array.isArray(rawX) ? rawX[0] : rawX || null;
    }
  }
  if (authHeader) {
    if (authHeader.startsWith("Bearer ")) {
      return authHeader.slice(7).trim();
    }
    return authHeader.trim();
  }
  if (xApiKey && typeof xApiKey === "string" && xApiKey.trim()) {
    return xApiKey.trim();
  }
  return null;
}
async function validateApiKey(rawKey, requiredScope) {
  if (!rawKey || typeof rawKey !== "string") {
    return {
      valid: false,
      error: 'Missing API key. Provide "Authorization: Bearer <token>" or "x-api-key" header.',
      statusCode: 401
    };
  }
  const hashed = hashApiKey(rawKey);
  try {
    const records = await db.select().from(api_keys).where(eq3(api_keys.key_hash, hashed)).limit(1);
    if (records.length === 0) {
      return {
        valid: false,
        error: "Invalid or revoked API key.",
        statusCode: 403
      };
    }
    const key2 = records[0];
    const scopes = Array.isArray(key2.scopes) ? key2.scopes : [];
    if (requiredScope && !scopes.includes("admin") && !scopes.includes(requiredScope)) {
      return {
        valid: false,
        error: `Unauthorized: Token requires '${requiredScope}' scope. Granted scopes: [${scopes.join(", ")}]`,
        statusCode: 403
      };
    }
    db.update(api_keys).set({ last_used_at: /* @__PURE__ */ new Date() }).where(eq3(api_keys.id, key2.id)).catch((err) => console.warn("Failed to update last_used_at:", err));
    return {
      valid: true,
      apiKey: key2
    };
  } catch (dbErr) {
    console.error("API key verification error:", dbErr);
    return {
      valid: false,
      error: "Internal authentication error.",
      statusCode: 500
    };
  }
}
function requireApiKey(requiredScope) {
  return async (req, res, next) => {
    const rawToken = extractTokenFromRequest(req);
    const auth = await validateApiKey(rawToken, requiredScope);
    if (!auth.valid) {
      return res.status(auth.statusCode || 401).json({
        success: false,
        error: auth.error
      });
    }
    req.apiKey = auth.apiKey;
    next();
  };
}

// src/server/auth.ts
import crypto4 from "node:crypto";
var COOKIE = "am_session";
var SESSION_DAYS = 30;
function adminUsername() {
  return process.env.ADMIN_USERNAME?.trim() || "mraaziqp";
}
function isAuthConfigured() {
  return Boolean(process.env.ADMIN_PASSWORD?.trim());
}
function sessionUser() {
  return {
    username: adminUsername(),
    displayName: process.env.ADMIN_DISPLAY_NAME?.trim() || adminUsername(),
    role: "Administrator",
    primaryEmail: process.env.ADMIN_EMAIL?.trim() || process.env.AETHERMAIL_SENDER?.trim() || "",
    domain: process.env.BUSINESS_DOMAIN?.trim() || (process.env.AETHERMAIL_SENDER?.split("@")[1] ?? "")
  };
}
function signingKey() {
  const base = process.env.APP_SECRET?.trim() || process.env.ADMIN_PASSWORD?.trim();
  if (!base) throw new Error("ADMIN_PASSWORD is not configured");
  return crypto4.createHash("sha256").update(`aethermail:session:${base}`).digest();
}
function safeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto4.timingSafeEqual(ab, bb);
}
function issueSessionToken(username) {
  const payload = Buffer.from(
    JSON.stringify({ u: username, exp: Date.now() + SESSION_DAYS * 864e5, n: crypto4.randomBytes(6).toString("hex") })
  ).toString("base64url");
  const mac = crypto4.createHmac("sha256", signingKey()).update(payload).digest("base64url");
  return `am1.${payload}.${mac}`;
}
function verifySessionToken(token) {
  if (!token || !token.startsWith("am1.") || !isAuthConfigured()) return null;
  const [, payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const expected = crypto4.createHmac("sha256", signingKey()).update(payload).digest("base64url");
  if (!safeEqual(mac, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof data.exp !== "number" || data.exp < Date.now()) return null;
    return { username: data.u };
  } catch {
    return null;
  }
}
function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0 && part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}
function sessionFromRequest(req) {
  const cookie = verifySessionToken(readCookie(req, COOKIE));
  if (cookie) return cookie;
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer am1.")) return verifySessionToken(auth.slice(7).trim());
  return null;
}
function isHttps(req) {
  return req.secure || req.headers["x-forwarded-proto"] === "https" || !!process.env.VERCEL;
}
function setSessionCookie(req, res, token, maxAgeSeconds) {
  const parts = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`
  ];
  if (isHttps(req)) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}
var failures = /* @__PURE__ */ new Map();
function handleLogin(req, res) {
  if (!isAuthConfigured()) {
    return res.status(503).json({
      success: false,
      error: "Login is not configured on the server. Set ADMIN_PASSWORD (and APP_SECRET) in the environment, then redeploy."
    });
  }
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
  const f = failures.get(ip);
  if (f && f.count >= 5 && f.until > Date.now()) {
    return res.status(429).json({ success: false, error: "Too many failed attempts. Try again in a minute." });
  }
  const { username, password } = req.body ?? {};
  const ok = typeof username === "string" && typeof password === "string" && safeEqual(username.trim().toLowerCase(), adminUsername().toLowerCase()) && safeEqual(password, process.env.ADMIN_PASSWORD.trim());
  if (!ok) {
    const next = { count: (f && f.until > Date.now() ? f.count : 0) + 1, until: Date.now() + 6e4 };
    failures.set(ip, next);
    return res.status(401).json({ success: false, error: "Invalid username or password." });
  }
  failures.delete(ip);
  const token = issueSessionToken(adminUsername());
  setSessionCookie(req, res, token, SESSION_DAYS * 86400);
  return res.json({ success: true, user: sessionUser() });
}
function handleLogout(req, res) {
  setSessionCookie(req, res, "", 0);
  res.json({ success: true });
}
function handleSessionStatus(req, res) {
  const session = sessionFromRequest(req);
  res.json({
    authenticated: Boolean(session),
    configured: isAuthConfigured(),
    user: session ? sessionUser() : null
  });
}
function requireSession(req, res, next) {
  if (sessionFromRequest(req)) return next();
  return res.status(401).json({ success: false, error: "Not signed in." });
}
function requireSessionOrApiKey(scope = "admin") {
  return async (req, res, next) => {
    if (sessionFromRequest(req)) return next();
    const auth = await validateApiKey(extractTokenFromRequest(req), scope);
    if (auth.valid) {
      req.apiKey = auth.apiKey;
      return next();
    }
    return res.status(auth.statusCode || 401).json({ success: false, error: auth.error || "Not signed in." });
  };
}
function requireCronOrSession(req, res, next) {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = req.headers.authorization;
  if (secret && auth && safeEqual(auth, `Bearer ${secret}`)) return next();
  return requireSession(req, res, next);
}

// src/lib/dkim.ts
import crypto5 from "node:crypto";
function generateDkimKeyPair() {
  const { publicKey, privateKey } = crypto5.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: "spki",
      format: "pem"
    },
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem"
    }
  });
  const cleanBase64PublicKey = publicKey.replace(/-----BEGIN PUBLIC KEY-----/, "").replace(/-----END PUBLIC KEY-----/, "").replace(/\s+/g, "");
  const dnsTxtValue = `v=DKIM1; k=rsa; p=${cleanBase64PublicKey}`;
  return {
    privateKey,
    publicKey,
    dnsTxtValue
  };
}
function buildDomainDnsRecords(domainName, dkimTxtValue) {
  const normalizedDomain = domainName.trim().toLowerCase();
  const mailHost = process.env.MAIL_SERVER_HOST || `mail.${normalizedDomain}`;
  const selector = "default";
  const mxRecord = `10 ${mailHost}`;
  const spfRecord = "v=spf1 mx -all";
  const dkimHost = `${selector}._domainkey`;
  const dmarcHost = "_dmarc";
  const dmarcRecord = `v=DMARC1; p=quarantine; rua=mailto:postmaster@${normalizedDomain}`;
  const records = [
    {
      type: "MX",
      host: "@",
      value: mxRecord,
      priority: 10,
      description: "Directs incoming email traffic to Stalwart Mail Server"
    },
    {
      type: "TXT",
      host: "@",
      value: spfRecord,
      description: "SPF policy permitting only designated MX server to dispatch mail"
    },
    {
      type: "TXT",
      host: dkimHost,
      value: dkimTxtValue,
      description: "Cryptographic DKIM public key for authenticating outbound signatures"
    },
    {
      type: "TXT",
      host: dmarcHost,
      value: dmarcRecord,
      description: "DMARC policy instructing recipient servers to quarantine spoofed emails"
    }
  ];
  return {
    domainName: normalizedDomain,
    selector,
    mxRecord,
    spfRecord,
    dkimTxtValue,
    dkimHost,
    dmarcRecord,
    dmarcHost,
    records
  };
}

// src/lib/stalwart.ts
import nodemailer2 from "nodemailer";
function getStalwartConfig() {
  const resendApiKey = process.env.RESEND_API_KEY || process.env.SMTP_PASS || "";
  const explicitHost = process.env.SMTP_HOST || process.env.STALWART_SMTP_HOST;
  return {
    apiUrl: process.env.STALWART_API_URL || "http://localhost:8080",
    adminUser: process.env.STALWART_ADMIN_USER || "admin",
    adminSecret: process.env.STALWART_ADMIN_SECRET ?? "",
    smtpHost: explicitHost || "smtp.resend.com",
    smtpPort: Number(process.env.SMTP_PORT) || 465,
    smtpUser: process.env.SMTP_USER || "resend",
    smtpPass: process.env.SMTP_PASS || resendApiKey
  };
}
async function provisionStalwartDomain(domainName) {
  const config = getStalwartConfig();
  try {
    const authHeader = "Basic " + Buffer.from(`${config.adminUser}:${config.adminSecret}`).toString("base64");
    const res = await fetch(`${config.apiUrl}/api/directory/domain`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader
      },
      body: JSON.stringify({
        domain: domainName,
        description: `Virtual domain provisioned by AetherMail for ${domainName}`
      }),
      signal: AbortSignal.timeout(5e3)
    });
    if (res.ok || res.status === 409) {
      return { success: true };
    }
    const errorText = await res.text().catch(() => "");
    return {
      success: false,
      error: `Stalwart API responded with HTTP ${res.status}: ${errorText.slice(0, 150)}`
    };
  } catch (err) {
    console.warn(`[Stalwart] Domain provisioning notice for ${domainName}:`, err instanceof Error ? err.message : String(err));
    return {
      success: true
      // Gracefully marked for sync when container initializes
    };
  }
}
async function provisionStalwartMailbox(emailAddress, secretHash) {
  const config = getStalwartConfig();
  try {
    const authHeader = "Basic " + Buffer.from(`${config.adminUser}:${config.adminSecret}`).toString("base64");
    const [localPart, domain] = emailAddress.split("@");
    const res = await fetch(`${config.apiUrl}/api/principal`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader
      },
      body: JSON.stringify({
        type: "individual",
        name: emailAddress,
        secret: secretHash,
        emails: [emailAddress],
        domain,
        description: `Mailbox account for ${localPart}`
      }),
      signal: AbortSignal.timeout(5e3)
    });
    if (res.ok || res.status === 409) {
      return { success: true };
    }
    const errorText = await res.text().catch(() => "");
    return {
      success: false,
      error: `Stalwart API rejected mailbox creation (HTTP ${res.status}): ${errorText.slice(0, 150)}`
    };
  } catch (err) {
    console.warn(`[Stalwart] Mailbox provisioning notice for ${emailAddress}:`, err instanceof Error ? err.message : String(err));
    return {
      success: true
    };
  }
}

// src/lib/agent-auth.ts
init_db();
init_schema();
import crypto6 from "node:crypto";
import { eq as eq4 } from "drizzle-orm";
function hashAgentKey(rawToken) {
  return crypto6.createHash("sha256").update(rawToken.trim()).digest("hex");
}
function generateAgentKey(botName = "Jarvis", scopes = ["super_admin", "read_all", "send_as_any"]) {
  const entropy = crypto6.randomBytes(32).toString("hex");
  const rawKey = `jrv_root_${entropy}`;
  const keyHash = hashAgentKey(rawKey);
  const id = `ak_${Date.now()}_${crypto6.randomBytes(4).toString("hex")}`;
  return {
    id,
    rawKey,
    keyHash,
    botName,
    scopes
  };
}
async function authenticateAgentToken(rawToken, requiredScope) {
  if (!rawToken || !rawToken.startsWith("jrv_root_")) {
    return { valid: false, error: "Invalid agent authorization header. Key must start with jrv_root_." };
  }
  const tokenHash = hashAgentKey(rawToken);
  const matched = await db.select().from(agent_keys).where(eq4(agent_keys.key_hash, tokenHash)).limit(1);
  if (matched.length === 0) {
    return { valid: false, error: "Unauthorized: Agent key not found or revoked." };
  }
  const agent = matched[0];
  const scopes = agent.scopes || [];
  if (requiredScope && !scopes.includes("super_admin") && !scopes.includes(requiredScope)) {
    return {
      valid: false,
      error: `Forbidden: Agent does not hold required scope "${requiredScope}". Current scopes: [${scopes.join(", ")}]`
    };
  }
  db.update(agent_keys).set({ last_active: /* @__PURE__ */ new Date() }).where(eq4(agent_keys.id, agent.id)).catch((err) => console.warn("Failed to update agent last_active timestamp:", err));
  return {
    valid: true,
    agent: {
      agentId: agent.id,
      botName: agent.bot_name,
      scopes
    }
  };
}
function requireAgentScope(requiredScope) {
  return async (req, res, next) => {
    const authHeader = req.headers["authorization"] || req.headers["x-agent-key"];
    if (!authHeader || typeof authHeader !== "string") {
      return res.status(401).json({
        success: false,
        error: "Missing agent credentials in Authorization or x-agent-key header."
      });
    }
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : authHeader.trim();
    const result = await authenticateAgentToken(token, requiredScope);
    if (!result.valid) {
      const statusCode = result.error?.startsWith("Forbidden") ? 403 : 401;
      return res.status(statusCode).json({ success: false, error: result.error });
    }
    req.agent = result.agent;
    next();
  };
}
async function ensureJarvisRootKey() {
  const existing = await db.select().from(agent_keys).where(eq4(agent_keys.bot_name, "Jarvis")).limit(1);
  if (existing.length > 0) {
    return { keyInfo: existing[0] };
  }
  const newKey = generateAgentKey("Jarvis", ["super_admin", "read_all", "send_as_any"]);
  const newRecord = {
    id: newKey.id,
    bot_name: newKey.botName,
    key_hash: newKey.keyHash,
    scopes: newKey.scopes,
    created_at: /* @__PURE__ */ new Date()
  };
  const [inserted] = await db.insert(agent_keys).values(newRecord).returning();
  return {
    rawKey: newKey.rawKey,
    keyInfo: inserted
  };
}

// src/server/v1-router.ts
var v1Router = Router();
v1Router.get("/emails", requireApiKey("read"), async (req, res) => {
  try {
    const { category, requires_alert, is_read, since, limit, accountId } = req.query;
    const conditions = [];
    if (accountId && typeof accountId === "string" && accountId !== "all") {
      conditions.push(eq8(emails.account_id, accountId));
    }
    if (category && typeof category === "string" && category !== "all") {
      conditions.push(eq8(emails.category, category));
    }
    if (requires_alert !== void 0) {
      conditions.push(eq8(emails.requires_alert, requires_alert === "true" || requires_alert === "1"));
    }
    if (is_read !== void 0) {
      conditions.push(eq8(emails.is_read, is_read === "true" || is_read === "1"));
    }
    if (since && typeof since === "string") {
      const sinceDate = new Date(isNaN(Number(since)) ? since : Number(since));
      if (!isNaN(sinceDate.getTime())) {
        conditions.push(gte2(emails.received_at, sinceDate));
      }
    }
    const maxLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const query = db.select({
      id: emails.id,
      account_id: emails.account_id,
      thread_id: emails.thread_id,
      subject: emails.subject,
      sender: emails.sender,
      body_snippet: emails.body_snippet,
      full_body: emails.full_body,
      category: emails.category,
      ai_summary: emails.ai_summary,
      requires_alert: emails.requires_alert,
      is_read: emails.is_read,
      received_at: emails.received_at,
      account_email: accounts.email_address
    }).from(emails).leftJoin(accounts, eq8(emails.account_id, accounts.id)).orderBy(desc2(emails.received_at)).limit(maxLimit);
    const results = conditions.length > 0 ? await query.where(and3(...conditions)) : await query;
    return res.json({
      success: true,
      count: results.length,
      data: results.map((r) => ({
        ...r,
        received_at: r.received_at ? r.received_at.toISOString() : null
      }))
    });
  } catch (error) {
    console.error("v1 GET /emails error:", error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to query emails"
    });
  }
});
v1Router.get("/emails/:id", requireApiKey("read"), async (req, res) => {
  try {
    const { id } = req.params;
    const results = await db.select({
      id: emails.id,
      account_id: emails.account_id,
      thread_id: emails.thread_id,
      subject: emails.subject,
      sender: emails.sender,
      body_snippet: emails.body_snippet,
      full_body: emails.full_body,
      category: emails.category,
      ai_summary: emails.ai_summary,
      requires_alert: emails.requires_alert,
      is_read: emails.is_read,
      received_at: emails.received_at,
      account_email: accounts.email_address
    }).from(emails).leftJoin(accounts, eq8(emails.account_id, accounts.id)).where(eq8(emails.id, id)).limit(1);
    if (results.length === 0) {
      return res.status(404).json({ success: false, error: `Email ${id} not found.` });
    }
    const row = results[0];
    return res.json({
      success: true,
      data: {
        ...row,
        received_at: row.received_at ? row.received_at.toISOString() : null
      }
    });
  } catch (error) {
    console.error("v1 GET /emails/:id error:", error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch email"
    });
  }
});
v1Router.post("/emails/send", requireApiKey("send"), async (req, res) => {
  try {
    const { accountId, to, cc, bcc, subject, htmlBody, inReplyToId } = req.body;
    if (!to || !subject || !htmlBody) {
      return res.status(400).json({
        success: false,
        error: "Missing required parameters: to, subject, htmlBody."
      });
    }
    let targetAccountId = accountId;
    if (!targetAccountId) {
      const accList = await db.select().from(accounts).limit(1);
      if (accList.length > 0) {
        targetAccountId = accList[0].id;
      } else {
        return res.status(400).json({
          success: false,
          error: "No accounts configured in AetherMail to send from."
        });
      }
    }
    const result = await sendEmailAction({
      accountId: targetAccountId,
      to,
      cc,
      bcc,
      subject,
      htmlBody,
      inReplyToId
    });
    if (!result.success) {
      return res.status(400).json(result);
    }
    return res.status(201).json(result);
  } catch (error) {
    console.error("v1 POST /emails/send error:", error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Outbound dispatch failed"
    });
  }
});
v1Router.patch("/emails/:id", requireApiKey("write"), async (req, res) => {
  try {
    const { id } = req.params;
    const { is_read, category, requires_alert } = req.body;
    const updates = {};
    if (typeof is_read === "boolean") updates.is_read = is_read;
    if (typeof category === "string") updates.category = category;
    if (typeof requires_alert === "boolean") updates.requires_alert = requires_alert;
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        error: "No valid update fields provided (is_read, category, requires_alert)."
      });
    }
    const updated = await db.update(emails).set(updates).where(eq8(emails.id, id)).returning();
    if (updated.length === 0) {
      return res.status(404).json({ success: false, error: `Email ${id} not found.` });
    }
    return res.json({
      success: true,
      data: updated[0],
      message: `Email ${id} updated successfully.`
    });
  } catch (error) {
    console.error("v1 PATCH /emails/:id error:", error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to update email"
    });
  }
});
v1Router.get("/keys", requireSessionOrApiKey("admin"), async (_req, res) => {
  try {
    const keys = await db.select({
      id: api_keys.id,
      name: api_keys.name,
      prefix: api_keys.prefix,
      scopes: api_keys.scopes,
      last_used_at: api_keys.last_used_at,
      created_at: api_keys.created_at
    }).from(api_keys).orderBy(desc2(api_keys.created_at));
    return res.json({
      success: true,
      keys: keys.map((k) => ({
        ...k,
        last_used_at: k.last_used_at ? k.last_used_at.toISOString() : null,
        created_at: k.created_at ? k.created_at.toISOString() : null
      }))
    });
  } catch (error) {
    console.error("v1 GET /keys error:", error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to list API keys"
    });
  }
});
v1Router.post("/keys", requireSessionOrApiKey("admin"), async (req, res) => {
  try {
    const { name, scopes } = req.body;
    if (!name || typeof name !== "string") {
      return res.status(400).json({
        success: false,
        error: "Key name is required."
      });
    }
    const validScopes = ["read", "write", "send", "admin"];
    const chosenScopes = Array.isArray(scopes) && scopes.length > 0 ? scopes.filter((s) => validScopes.includes(s)) : ["read"];
    const newKeyGen = generateNewApiKey(name.trim(), chosenScopes);
    const inserted = await db.insert(api_keys).values({
      id: newKeyGen.id,
      name: newKeyGen.name,
      key_hash: newKeyGen.keyHash,
      prefix: newKeyGen.prefix,
      scopes: newKeyGen.scopes
    }).returning();
    return res.status(201).json({
      success: true,
      key: {
        id: inserted[0].id,
        name: inserted[0].name,
        prefix: inserted[0].prefix,
        scopes: inserted[0].scopes,
        rawKey: newKeyGen.rawKey,
        // Returned ONLY ONCE on generation!
        created_at: inserted[0].created_at ? inserted[0].created_at.toISOString() : (/* @__PURE__ */ new Date()).toISOString()
      }
    });
  } catch (error) {
    console.error("v1 POST /keys error:", error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to generate API key"
    });
  }
});
v1Router.delete("/keys/:id", requireSessionOrApiKey("admin"), async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await db.delete(api_keys).where(eq8(api_keys.id, id)).returning();
    if (deleted.length === 0) {
      return res.status(404).json({ success: false, error: "Key not found" });
    }
    return res.json({
      success: true,
      message: `API Key '${deleted[0].name}' (${deleted[0].prefix}) revoked successfully.`
    });
  } catch (error) {
    console.error("v1 DELETE /keys/:id error:", error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to revoke API key"
    });
  }
});
v1Router.get("/metrics", requireSessionOrApiKey("admin"), async (_req, res) => {
  try {
    const [totals] = await db.select({
      total: sql2`count(*)::int`,
      unread: sql2`count(*) filter (where ${emails.is_read} = false)::int`,
      alerts: sql2`count(*) filter (where ${emails.requires_alert} = true)::int`
    }).from(emails);
    const byCategory = await db.select({ category: emails.category, n: sql2`count(*)::int` }).from(emails).groupBy(emails.category);
    const [keyCount] = await db.select({ n: sql2`count(*)::int` }).from(api_keys);
    const allAccs = await db.select({ sync_status: accounts.sync_status }).from(accounts);
    const categoryDistribution = {
      urgent: 0,
      financial: 0,
      work: 0,
      personal: 0,
      newsletter: 0,
      automated: 0,
      spam: 0
    };
    for (const row of byCategory) categoryDistribution[row.category] = row.n;
    const allEmails = { length: totals.total };
    const unreadCount = totals.unread;
    const alertCount = totals.alerts;
    const allKeys = { length: keyCount.n };
    return res.json({
      success: true,
      metrics: {
        totalEmails: allEmails.length,
        unreadCount,
        alertCount,
        categoryDistribution,
        activeKeysCount: allKeys.length,
        syncStatus: allAccs.every((a) => a.sync_status === "synced") ? "synced" : "syncing",
        lastUpdated: (/* @__PURE__ */ new Date()).toISOString()
      }
    });
  } catch (error) {
    console.error("v1 GET /metrics error:", error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to compute metrics"
    });
  }
});
v1Router.post("/admin/domains", requireSessionOrApiKey("admin"), async (req, res) => {
  try {
    const { domain_name } = req.body;
    if (!domain_name || typeof domain_name !== "string") {
      return res.status(400).json({
        success: false,
        error: 'domain_name string is required (e.g. "acme-corp.com").'
      });
    }
    const normalizedDomain = domain_name.trim().toLowerCase();
    const existing = await db.select().from(domains).where(eq8(domains.domain_name, normalizedDomain)).limit(1);
    if (existing.length > 0) {
      const existingDomain = existing[0];
      const dnsConfig2 = buildDomainDnsRecords(existingDomain.domain_name, existingDomain.dkim_public_key);
      return res.json({
        success: true,
        message: "Domain already registered. Retrieved existing DNS configuration.",
        domain: {
          id: existingDomain.id,
          domain_name: existingDomain.domain_name,
          is_verified: existingDomain.is_verified,
          created_at: existingDomain.created_at?.toISOString() || (/* @__PURE__ */ new Date()).toISOString(),
          dns_records: dnsConfig2.records
        },
        instructions: "Add these records to your domain registrar DNS settings to complete verification."
      });
    }
    const dkim = generateDkimKeyPair();
    const dnsConfig = buildDomainDnsRecords(normalizedDomain, dkim.dnsTxtValue);
    const domainId = `dom_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newDomainRecord = {
      id: domainId,
      domain_name: normalizedDomain,
      is_verified: false,
      dkim_private_key: dkim.privateKey,
      dkim_public_key: dkim.dnsTxtValue,
      dns_mx_record: dnsConfig.mxRecord,
      dns_spf_record: dnsConfig.spfRecord,
      created_at: /* @__PURE__ */ new Date()
    };
    const [inserted] = await db.insert(domains).values(newDomainRecord).returning();
    await provisionStalwartDomain(normalizedDomain);
    return res.status(201).json({
      success: true,
      domain: {
        id: inserted.id,
        domain_name: inserted.domain_name,
        is_verified: inserted.is_verified,
        created_at: inserted.created_at ? inserted.created_at.toISOString() : (/* @__PURE__ */ new Date()).toISOString(),
        dns_records: dnsConfig.records
      },
      instructions: "Configure these DNS records with your registrar. Once DNS propagates, mailboxes can be activated."
    });
  } catch (error) {
    console.error("v1 POST /admin/domains error:", error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Internal domain provisioning failure"
    });
  }
});
v1Router.get("/admin/domains", requireSessionOrApiKey("admin"), async (_req, res) => {
  try {
    const allDomains = await db.select().from(domains).orderBy(desc2(domains.created_at));
    const enriched = allDomains.map((d) => {
      const dnsConfig = buildDomainDnsRecords(d.domain_name, d.dkim_public_key);
      return {
        id: d.id,
        domain_name: d.domain_name,
        is_verified: d.is_verified,
        created_at: d.created_at ? d.created_at.toISOString() : null,
        dns_records: dnsConfig.records
      };
    });
    return res.json({
      success: true,
      count: enriched.length,
      domains: enriched
    });
  } catch (error) {
    console.error("v1 GET /admin/domains error:", error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to list domains"
    });
  }
});
v1Router.post("/admin/mailboxes", requireSessionOrApiKey("admin"), async (req, res) => {
  try {
    const { domain_id, email_address, password } = req.body;
    if (!email_address || !email_address.includes("@")) {
      return res.status(400).json({
        success: false,
        error: 'email_address is required (e.g. "contact@company.com").'
      });
    }
    const email = email_address.trim().toLowerCase();
    const domainPart = email.split("@")[1];
    let targetDomainId = domain_id;
    if (!targetDomainId) {
      const matched = await db.select().from(domains).where(eq8(domains.domain_name, domainPart)).limit(1);
      if (matched.length === 0) {
        return res.status(404).json({
          success: false,
          error: `Domain "${domainPart}" is not registered. Provision domain first via POST /api/v1/admin/domains.`
        });
      }
      targetDomainId = matched[0].id;
    }
    const existingMbx = await db.select().from(mailboxes).where(eq8(mailboxes.email_address, email)).limit(1);
    if (existingMbx.length > 0) {
      return res.status(409).json({
        success: false,
        error: `Mailbox "${email}" already exists.`
      });
    }
    const salt = crypto7.randomBytes(16).toString("hex");
    const hash = crypto7.pbkdf2Sync(password || "AetherPass123!", salt, 1e4, 32, "sha256").toString("hex");
    const pwdHash = `${salt}:${hash}`;
    await provisionStalwartMailbox(email, pwdHash);
    const mailboxId = `mbx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newMbx = {
      id: mailboxId,
      domain_id: targetDomainId,
      email_address: email,
      password_hash: pwdHash,
      is_active: true,
      created_at: /* @__PURE__ */ new Date()
    };
    const [inserted] = await db.insert(mailboxes).values(newMbx).returning();
    await db.insert(accounts).values({
      id: mailboxId,
      provider: "stalwart",
      email_address: email,
      sync_status: "synced",
      created_at: /* @__PURE__ */ new Date()
    }).onConflictDoNothing();
    return res.status(201).json({
      success: true,
      message: `Mailbox ${email} provisioned and activated successfully.`,
      mailbox: {
        id: inserted.id,
        domain_id: inserted.domain_id,
        email_address: inserted.email_address,
        is_active: inserted.is_active,
        created_at: inserted.created_at ? inserted.created_at.toISOString() : (/* @__PURE__ */ new Date()).toISOString()
      }
    });
  } catch (error) {
    console.error("v1 POST /admin/mailboxes error:", error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to provision mailbox"
    });
  }
});
v1Router.get("/admin/mailboxes", requireSessionOrApiKey("admin"), async (req, res) => {
  try {
    const domainId = req.query.domain_id;
    let query = db.select({
      id: mailboxes.id,
      domain_id: mailboxes.domain_id,
      domain_name: domains.domain_name,
      email_address: mailboxes.email_address,
      is_active: mailboxes.is_active,
      created_at: mailboxes.created_at
    }).from(mailboxes).leftJoin(domains, eq8(mailboxes.domain_id, domains.id)).orderBy(desc2(mailboxes.created_at));
    const rows = domainId ? await query.where(eq8(mailboxes.domain_id, domainId)) : await query;
    return res.json({
      success: true,
      count: rows.length,
      mailboxes: rows.map((m) => ({
        ...m,
        created_at: m.created_at ? m.created_at.toISOString() : null
      }))
    });
  } catch (error) {
    console.error("v1 GET /admin/mailboxes error:", error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to list mailboxes"
    });
  }
});
v1Router.post("/agent/provision-jarvis", requireSessionOrApiKey("admin"), async (_req, res) => {
  try {
    const result = await ensureJarvisRootKey();
    return res.json({
      success: true,
      message: result.rawKey ? "New Jarvis root master key provisioned. Save the raw key securely!" : "Jarvis root key exists in database.",
      agent: {
        id: result.keyInfo.id,
        bot_name: result.keyInfo.bot_name,
        scopes: result.keyInfo.scopes,
        raw_key: result.rawKey || "[REDACTED: Existing key is securely hashed in PostgreSQL]"
      }
    });
  } catch (error) {
    console.error("v1 POST /agent/provision-jarvis error:", error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to provision Jarvis root key"
    });
  }
});
v1Router.get("/agent/triage", requireAgentScope("read_all"), async (req, res) => {
  try {
    const unreadOnly = req.query.unread_only !== "false";
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const since = req.query.since;
    const conditions = [];
    if (unreadOnly) {
      conditions.push(eq8(emails.is_read, false));
    }
    if (since) {
      const sinceDate = new Date(isNaN(Number(since)) ? since : Number(since));
      if (!isNaN(sinceDate.getTime())) {
        conditions.push(gte2(emails.received_at, sinceDate));
      }
    }
    const query = db.select({
      id: emails.id,
      account_id: emails.account_id,
      account_email: accounts.email_address,
      thread_id: emails.thread_id,
      subject: emails.subject,
      sender: emails.sender,
      body_snippet: emails.body_snippet,
      full_body: emails.full_body,
      category: emails.category,
      ai_summary: emails.ai_summary,
      requires_alert: emails.requires_alert,
      is_read: emails.is_read,
      received_at: emails.received_at
    }).from(emails).leftJoin(accounts, eq8(emails.account_id, accounts.id)).orderBy(desc2(emails.received_at)).limit(limit);
    const rows = conditions.length > 0 ? await query.where(and3(...conditions)) : await query;
    return res.json({
      success: true,
      agent: req.agent?.botName,
      total: rows.length,
      emails: rows.map((r) => ({
        ...r,
        received_at: r.received_at ? r.received_at.toISOString() : null
      }))
    });
  } catch (error) {
    console.error("v1 GET /agent/triage error:", error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to query triage telemetry"
    });
  }
});
v1Router.patch("/agent/triage", requireAgentScope("read_all"), async (req, res) => {
  try {
    const { email_id, category, ai_summary, requires_alert, is_read } = req.body;
    if (!email_id) {
      return res.status(400).json({ success: false, error: "email_id is required." });
    }
    const updates = {};
    if (category) updates.category = category;
    if (ai_summary !== void 0) updates.ai_summary = ai_summary;
    if (requires_alert !== void 0) updates.requires_alert = Boolean(requires_alert);
    if (is_read !== void 0) updates.is_read = Boolean(is_read);
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        error: "No valid triage fields provided (category, ai_summary, requires_alert, is_read)."
      });
    }
    const updated = await db.update(emails).set(updates).where(eq8(emails.id, email_id)).returning();
    if (updated.length === 0) {
      return res.status(404).json({ success: false, error: `Email "${email_id}" not found.` });
    }
    return res.json({
      success: true,
      message: `Email "${email_id}" triaged successfully by ${req.agent?.botName}.`,
      data: updated[0]
    });
  } catch (error) {
    console.error("v1 PATCH /agent/triage error:", error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to update email record"
    });
  }
});
v1Router.post("/agent/dispatch", requireAgentScope("send_as_any"), async (req, res) => {
  try {
    const { from, to, subject, htmlBody, textBody, replyTo, thread_id } = req.body;
    if (!to || !subject || !htmlBody) {
      return res.status(400).json({
        success: false,
        error: "Required fields missing: to, subject, and htmlBody are required."
      });
    }
    const defaultSender = process.env.JARVIS_DEFAULT_SENDER?.trim() || process.env.AETHERMAIL_SENDER?.trim();
    const sender = String(from || defaultSender || "").trim();
    if (!sender) {
      return res.status(400).json({
        success: false,
        error: 'No sender: pass "from" or set JARVIS_DEFAULT_SENDER / AETHERMAIL_SENDER.'
      });
    }
    const result = await sendEmailAction({
      accountId: sender,
      to,
      subject,
      htmlBody,
      inReplyToId: typeof req.body.in_reply_to === "string" ? req.body.in_reply_to : void 0,
      fromName: "Jarvis"
    });
    if (!result.success) {
      return res.status(502).json({ success: false, error: result.error, attempts: result.attempts });
    }
    return res.json({
      success: true,
      message: `Email accepted by ${result.provider}.`,
      agent: req.agent?.botName,
      data: {
        message_id: result.messageId,
        from: sender,
        to: Array.isArray(to) ? to.join(", ") : String(to),
        subject,
        transport: result.provider,
        dispatched_at: result.dispatchedAt,
        thread_id: thread_id ?? null,
        reply_to: replyTo ?? null,
        text_body_ignored: Boolean(textBody)
      }
    });
  } catch (error) {
    console.error("v1 POST /agent/dispatch error:", error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Internal dispatch failure"
    });
  }
});
v1Router.post("/sync/gmail", requireSessionOrApiKey("admin"), async (req, res) => {
  try {
    const { email_address, app_password, imap_host, imap_port } = req.body;
    if (!email_address || !app_password) {
      return res.status(400).json({
        success: false,
        error: "email_address and app_password are required."
      });
    }
    const { connectMailbox: connectMailbox2 } = await Promise.resolve().then(() => (init_mailbox_service(), mailbox_service_exports));
    try {
      const { report } = await connectMailbox2({ email_address, password: app_password, imap_host, imap_port });
      return res.json({
        success: true,
        message: `Connected ${email_address}; imported ${report?.imported ?? 0} message(s). It will keep syncing automatically.`,
        imported: report?.imported ?? 0,
        email_address
      });
    } catch (connectErr) {
      return res.status(400).json({
        success: false,
        error: connectErr instanceof Error ? connectErr.message : "Failed to connect mailbox."
      });
    }
  } catch (err) {
    console.error("v1 POST /sync/gmail error:", err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Internal IMAP sync error"
    });
  }
});

// server.ts
init_secrets();
init_sync_runner();
init_imap_sync();
init_notify();
init_business_mailboxes();
var PORT = Number(process.env.PORT) || 3007;
var IS_SERVERLESS = !!process.env.VERCEL;
var escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
var asyncRoute = (fn) => (req, res, next) => fn(req, res).catch(next);
function publicAccount(a) {
  const { oauth_tokens, sync_lease_until: _lease, ...rest } = a;
  return { ...rest, settings: publicMailboxConfig(oauth_tokens) };
}
async function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);
  app.use(
    express.json({
      limit: "15mb",
      verify: (req, _res, buf) => {
        req.rawBody = buf.toString("utf8");
      }
    })
  );
  app.use(express.urlencoded({ extended: false, limit: "1mb", verify: (req, _res, buf) => {
    req.rawBody = buf.toString("utf8");
  } }));
  app.get("/api/health", async (req, res) => {
    if (req.query.deep !== "1") return res.json({ status: "ok", time: (/* @__PURE__ */ new Date()).toISOString() });
    try {
      await ensureSchema();
      await db.execute(sql3`select 1`);
      res.json({ status: "ok", database: "ok", time: (/* @__PURE__ */ new Date()).toISOString() });
    } catch (err) {
      res.status(503).json({ status: "degraded", database: err.message, time: (/* @__PURE__ */ new Date()).toISOString() });
    }
  });
  app.get("/api/auth/session", handleSessionStatus);
  app.post("/api/auth/login", handleLogin);
  app.post("/api/auth/logout", handleLogout);
  app.use("/api", (req, res, next) => {
    ensureSchema().then(
      () => next(),
      (err) => {
        console.error("Database unavailable:", err);
        res.status(503).json({
          success: false,
          error: `Database unavailable: ${err.message}. Check DATABASE_URL (a Neon project over its quota fails like this too).`
        });
      }
    );
  });
  app.use("/api/v1", v1Router);
  app.all(
    "/api/cron/sync",
    requireCronOrSession,
    asyncRoute(async (_req, res) => {
      res.json(await syncAllAccounts({ budgetMs: IS_SERVERLESS ? 5e4 : 11e4 }));
    })
  );
  app.post(
    "/api/webhooks/resend",
    asyncRoute(async (req, res) => {
      const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
      if (!secret) return res.status(503).json({ error: "RESEND_WEBHOOK_SECRET is not configured." });
      const { verifySvixSignature: verifySvixSignature2, ingestResendEvent: ingestResendEvent2 } = await Promise.resolve().then(() => (init_resend_inbound(), resend_inbound_exports));
      if (!verifySvixSignature2(req.rawBody ?? "", req.headers, secret)) {
        return res.status(401).json({ error: "Invalid webhook signature." });
      }
      res.json({ success: true, ...await ingestResendEvent2(req.body) });
    })
  );
  app.post(
    ["/api/webhooks/payfast", "/api/payfast/webhook"],
    asyncRoute(async (req, res) => {
      const merchantId = process.env.PAYFAST_MERCHANT_ID?.trim();
      if (!merchantId) return res.status(503).send("PAYFAST_MERCHANT_ID not configured");
      const payload = req.body ?? {};
      if (String(payload.merchant_id ?? "") !== merchantId) return res.status(400).send("merchant mismatch");
      const raw = (req.rawBody ?? "").replace(/&signature=[^&]*/, "");
      const host = process.env.PAYFAST_SANDBOX === "true" ? "sandbox.payfast.co.za" : "www.payfast.co.za";
      const check = await fetch(`https://${host}/eng/query/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: raw,
        signal: AbortSignal.timeout(1e4)
      }).then((r) => r.text()).catch(() => "ERROR");
      if (check.trim() !== "VALID") return res.status(400).send("ITN not confirmed by PayFast");
      const notifyAddr = process.env.PAYFAST_NOTIFY_EMAIL?.trim().toLowerCase();
      const [target] = notifyAddr ? await db.select().from(accounts).where(eq10(accounts.email_address, notifyAddr)).limit(1) : await db.select().from(accounts).orderBy(accounts.created_at).limit(1);
      if (!target) return res.status(200).send("OK (no account to file under)");
      const status = payload.payment_status || "NOTIFICATION";
      const amount = payload.amount_gross ? `R${payload.amount_gross}` : "";
      const rows = Object.entries(payload).filter(([k]) => k !== "signature").map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#64748b">${escapeHtml(k)}</td><td style="padding:4px 0;font-family:monospace">${escapeHtml(String(v))}</td></tr>`).join("");
      const subject = `PayFast ${status}${amount ? ` \xB7 ${amount}` : ""}${payload.item_name ? ` \xB7 ${payload.item_name}` : ""}`;
      await db.insert(emails).values({
        id: `pf:${payload.pf_payment_id || Date.now()}:${status}`,
        account_id: target.id,
        thread_id: `pf:${payload.m_payment_id || payload.pf_payment_id || Date.now()}`,
        subject,
        sender: "PayFast ITN <itn@payfast.co.za>",
        body_snippet: `${status} ${amount} ${payload.name_first ?? ""} ${payload.email_address ?? ""}`.trim(),
        full_body: `<h3 style="margin:0 0 12px">Verified PayFast notification</h3><table style="font-size:13px;border-collapse:collapse">${rows}</table>`,
        category: "financial",
        ai_summary: `PayFast confirmed ${status.toLowerCase()} ${amount}`.trim(),
        requires_alert: status !== "COMPLETE",
        is_read: false,
        received_at: /* @__PURE__ */ new Date(),
        direction: "inbound",
        folder: "INBOX"
      }).onConflictDoNothing();
      if (status !== "COMPLETE") void pushAlert({ subject, sender: "PayFast", summary: `Payment ${status}` });
      return res.status(200).send("OK");
    })
  );
  app.post(
    "/api/webhooks/email",
    requireSessionOrApiKey("write"),
    asyncRoute(async (req, res) => {
      const { id, account_id, thread_id, subject, sender, body_snippet, full_body, received_at } = req.body;
      if (!account_id || !subject || !sender || !full_body) {
        return res.status(400).json({ error: "account_id, subject, sender and full_body are required." });
      }
      const [acc] = await db.select().from(accounts).where(eq10(accounts.id, account_id)).limit(1);
      if (!acc) return res.status(404).json({ error: `Unknown account_id "${account_id}".` });
      const ai = await processEmailWithGemini({ subject, sender, body: full_body });
      const emailId = id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const record = {
        id: emailId,
        account_id,
        thread_id: thread_id || emailId,
        subject,
        sender,
        body_snippet: body_snippet || String(full_body).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200),
        full_body,
        category: ai.category,
        ai_summary: ai.summary,
        requires_alert: ai.requires_alert,
        is_read: false,
        received_at: received_at ? new Date(received_at) : /* @__PURE__ */ new Date(),
        direction: "inbound"
      };
      const inserted = await db.insert(emails).values(record).onConflictDoNothing().returning();
      const alertDispatched = ai.requires_alert ? await pushAlert({ subject, sender, summary: ai.summary }) : false;
      res.status(201).json({ success: true, data: inserted[0] ?? record, alertDispatched });
    })
  );
  app.use("/api", requireSession);
  app.get("/api/auth/me", (_req, res) => res.json({ success: true, user: sessionUser() }));
  app.get(
    "/api/status",
    asyncRoute(async (_req, res) => {
      const accs = await db.select().from(accounts).orderBy(accounts.created_at);
      const perAccount = await db.select({
        account_id: emails.account_id,
        total: sql3`count(*)::int`,
        unread: sql3`count(*) filter (where ${emails.is_read} = false and ${emails.direction} = 'inbound' and ${emails.category} <> 'spam')::int`,
        latest: sql3`max(${emails.received_at})`
      }).from(emails).groupBy(emails.account_id);
      const perCategory = await db.select({
        category: emails.category,
        unread: sql3`count(*) filter (where ${emails.is_read} = false)::int`,
        total: sql3`count(*)::int`
      }).from(emails).groupBy(emails.category);
      const [alerts] = await db.select({ n: sql3`count(*)::int` }).from(emails).where(and4(eq10(emails.requires_alert, true), eq10(emails.is_read, false)));
      const [newest] = await db.select({ id: emails.id, at: emails.received_at }).from(emails).orderBy(desc3(emails.received_at)).limit(1);
      res.json({
        success: true,
        serverTime: (/* @__PURE__ */ new Date()).toISOString(),
        latestEmailId: newest?.id ?? null,
        latestEmailAt: newest?.at ?? null,
        alertCount: alerts?.n ?? 0,
        categories: perCategory,
        accounts: accs.map((a) => ({
          ...publicAccount(a),
          ...perAccount.find((p) => p.account_id === a.id) ?? { total: 0, unread: 0, latest: null }
        })),
        capabilities: {
          resend: Boolean(process.env.RESEND_API_KEY?.trim()),
          resendInbound: Boolean(process.env.RESEND_WEBHOOK_SECRET?.trim()),
          smtpRelay: Boolean(process.env.SMTP_HOST?.trim()),
          gmailRelay: Boolean(process.env.GMAIL_USER?.trim() && process.env.GMAIL_APP_PASSWORD?.trim()) && process.env.ALLOW_GMAIL_RELAY !== "false",
          ai: isAiConfigured(),
          push: Boolean(process.env.NTFY_TOPIC?.trim()),
          credentialVault: Boolean(process.env.APP_SECRET?.trim()),
          backgroundSync: !IS_SERVERLESS && process.env.BACKGROUND_SYNC !== "false",
          serverless: IS_SERVERLESS,
          defaultSender: process.env.AETHERMAIL_SENDER?.trim() || null
        }
      });
    })
  );
  app.get(
    "/api/accounts",
    asyncRoute(async (_req, res) => {
      const all = await db.select().from(accounts).orderBy(accounts.created_at);
      res.json(all.map(publicAccount));
    })
  );
  app.post(
    "/api/accounts/connect",
    asyncRoute(async (req, res) => {
      const { connectMailbox: connectMailbox2 } = await Promise.resolve().then(() => (init_mailbox_service(), mailbox_service_exports));
      try {
        const out = await connectMailbox2(req.body ?? {});
        res.status(201).json({ success: true, account: publicAccount(out.account), folders: out.folders, report: out.report });
      } catch (err) {
        res.status(400).json({ success: false, error: err.message });
      }
    })
  );
  app.post(
    "/api/accounts/address",
    asyncRoute(async (req, res) => {
      const email = String(req.body?.email_address ?? "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ success: false, error: "Enter a valid email address." });
      const domain = businessDomain();
      if (!domain) return res.status(400).json({ success: false, error: "Set BUSINESS_DOMAIN (or AETHERMAIL_SENDER) so AetherMail knows which domain Resend serves." });
      if (!email.endsWith(`@${domain}`)) {
        return res.status(400).json({ success: false, error: `Only addresses on ${domain} can be served by Resend. Use an IMAP preset for other mailboxes.` });
      }
      const display = typeof req.body?.display_name === "string" ? req.body.display_name.trim() || null : null;
      const [row] = await db.insert(accounts).values({ id: `acc_biz_${email.replace(/[^a-z0-9]/g, "_")}`, provider: "resend", email_address: email, display_name: display, sync_status: "synced" }).onConflictDoUpdate({ target: accounts.email_address, set: { display_name: display } }).returning();
      res.status(201).json({ success: true, account: publicAccount(row) });
    })
  );
  app.patch(
    "/api/accounts/:id",
    asyncRoute(async (req, res) => {
      const { display_name } = req.body ?? {};
      const [updated] = await db.update(accounts).set({ display_name: typeof display_name === "string" ? display_name.trim() || null : void 0 }).where(eq10(accounts.id, req.params.id)).returning();
      if (!updated) return res.status(404).json({ success: false, error: "Account not found" });
      res.json({ success: true, account: publicAccount(updated) });
    })
  );
  app.delete(
    "/api/accounts/:id",
    asyncRoute(async (req, res) => {
      const deleted = await db.delete(accounts).where(eq10(accounts.id, req.params.id)).returning({ id: accounts.id });
      res.json({ success: deleted.length > 0 });
    })
  );
  app.post(
    "/api/accounts/:id/resync",
    asyncRoute(async (req, res) => {
      const [acc] = await db.select().from(accounts).where(eq10(accounts.id, req.params.id)).limit(1);
      if (!acc) return res.status(404).json({ success: false, error: "Account not found" });
      await resetSyncState(acc.id);
      res.json(await syncOneAccount(acc, { force: true, deadline: Date.now() + 5e4 }));
    })
  );
  const runSync = asyncRoute(async (req, res) => {
    const force = req.query.force === "1" || req.body?.force === true;
    res.json(await syncAllAccounts({ force, budgetMs: IS_SERVERLESS ? 25e3 : 6e4 }));
  });
  app.post("/api/sync/all", runSync);
  app.get("/api/sync/all", runSync);
  const listColumns = {
    id: emails.id,
    account_id: emails.account_id,
    thread_id: emails.thread_id,
    subject: emails.subject,
    sender: emails.sender,
    body_snippet: emails.body_snippet,
    category: emails.category,
    ai_summary: emails.ai_summary,
    requires_alert: emails.requires_alert,
    is_read: emails.is_read,
    received_at: emails.received_at,
    recipients: emails.recipients,
    direction: emails.direction,
    folder: emails.folder,
    has_attachments: emails.has_attachments,
    account_email: accounts.email_address
  };
  app.get(
    "/api/emails",
    asyncRoute(async (req, res) => {
      const { accountId, category, alertOnly, search, unread, direction, before } = req.query;
      const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
      const conds = [];
      if (accountId && accountId !== "all") conds.push(eq10(emails.account_id, accountId));
      if (category === "sent") conds.push(eq10(emails.direction, "outbound"));
      else if (category && category !== "all") conds.push(eq10(emails.category, category));
      else if (!search) conds.push(sql3`${emails.category} <> 'spam'`);
      if (alertOnly === "true") conds.push(eq10(emails.requires_alert, true));
      if (unread === "true") conds.push(eq10(emails.is_read, false));
      if (direction === "inbound" || direction === "outbound") conds.push(eq10(emails.direction, direction));
      if (before) {
        const d = new Date(before);
        if (!isNaN(d.getTime())) conds.push(lt(emails.received_at, d));
      }
      if (search?.trim()) {
        const q = `%${search.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
        conds.push(
          or3(
            ilike2(emails.subject, q),
            ilike2(emails.sender, q),
            ilike2(emails.body_snippet, q),
            ilike2(emails.ai_summary, q),
            ilike2(emails.recipients, q)
          )
        );
      }
      const rows = await db.select(listColumns).from(emails).leftJoin(accounts, eq10(emails.account_id, accounts.id)).where(conds.length ? and4(...conds) : void 0).orderBy(desc3(emails.received_at)).limit(limit);
      res.json(rows);
    })
  );
  app.get(
    "/api/emails/:id",
    asyncRoute(async (req, res) => {
      const [row] = await db.select({ ...listColumns, full_body: emails.full_body, message_id: emails.message_id }).from(emails).leftJoin(accounts, eq10(emails.account_id, accounts.id)).where(eq10(emails.id, req.params.id)).limit(1);
      if (!row) return res.status(404).json({ error: "Email not found" });
      res.json(row);
    })
  );
  app.get(
    "/api/threads/:threadId",
    asyncRoute(async (req, res) => {
      const rows = await db.select({ ...listColumns, full_body: emails.full_body }).from(emails).leftJoin(accounts, eq10(emails.account_id, accounts.id)).where(eq10(emails.thread_id, req.params.threadId)).orderBy(emails.received_at).limit(50);
      res.json(rows);
    })
  );
  app.patch(
    "/api/emails/:id/read",
    asyncRoute(async (req, res) => {
      const [updated] = await db.update(emails).set({ is_read: Boolean(req.body?.is_read) }).where(eq10(emails.id, req.params.id)).returning({ id: emails.id, is_read: emails.is_read });
      if (!updated) return res.status(404).json({ error: "Email not found" });
      res.json(updated);
    })
  );
  app.patch(
    "/api/emails/:id",
    asyncRoute(async (req, res) => {
      const { category, requires_alert } = req.body ?? {};
      const valid = ["urgent", "personal", "newsletter", "automated", "work", "financial", "spam"];
      const set = {};
      if (typeof category === "string" && valid.includes(category)) set.category = category;
      if (typeof requires_alert === "boolean") set.requires_alert = requires_alert;
      if (!Object.keys(set).length) return res.status(400).json({ error: "Nothing to update" });
      const [updated] = await db.update(emails).set(set).where(eq10(emails.id, req.params.id)).returning({ id: emails.id });
      if (!updated) return res.status(404).json({ error: "Email not found" });
      res.json({ success: true, ...set });
    })
  );
  app.delete(
    "/api/emails/:id",
    asyncRoute(async (req, res) => {
      await db.delete(emails).where(eq10(emails.id, req.params.id));
      res.json({ success: true });
    })
  );
  app.post(
    "/api/emails/batch",
    asyncRoute(async (req, res) => {
      const { emailIds, action } = req.body ?? {};
      const result = await batchUpdateEmailsAction({ emailIds, action });
      res.status(result.success ? 200 : 400).json(result);
    })
  );
  app.post(
    "/api/emails/mark-all-read",
    asyncRoute(async (req, res) => {
      const accountId = typeof req.body?.accountId === "string" && req.body.accountId !== "all" ? req.body.accountId : null;
      const done = await db.update(emails).set({ is_read: true }).where(and4(eq10(emails.is_read, false), accountId ? eq10(emails.account_id, accountId) : void 0)).returning({ id: emails.id });
      res.json({ success: true, updated: done.length });
    })
  );
  app.post(
    "/api/send-email",
    asyncRoute(async (req, res) => {
      const { accountId, to, cc, bcc, subject, htmlBody, inReplyToId, attachments } = req.body ?? {};
      const result = await sendEmailAction({ accountId, to, cc, bcc, subject, htmlBody, inReplyToId, attachments });
      res.status(result.success ? 200 : 400).json(result);
    })
  );
  app.post(
    "/api/smart-search",
    asyncRoute(async (req, res) => {
      const { query, accountId } = req.body ?? {};
      res.json(await smartSearchAction(query || "", accountId));
    })
  );
  app.post(
    "/api/smart-reply",
    asyncRoute(async (req, res) => {
      const { emailId, tone, instructions } = req.body ?? {};
      if (!emailId) return res.status(400).json({ error: "emailId is required" });
      const [email] = await db.select().from(emails).where(eq10(emails.id, emailId)).limit(1);
      if (!email) return res.status(404).json({ error: "Email not found" });
      const draftReply = await generateSmartReplyWithGemini({
        subject: email.subject,
        sender: email.sender,
        body: email.full_body.replace(/<style[\s\S]*?<\/style>|<[^>]+>/gi, " ").replace(/\s+/g, " ").slice(0, 12e3),
        aiSummary: email.ai_summary,
        tone,
        instructions
      });
      res.json({ success: true, draftReply });
    })
  );
  app.get("/api/payfast/status", (_req, res) => {
    const merchantId = process.env.PAYFAST_MERCHANT_ID?.trim() || null;
    res.json({
      success: true,
      connected: Boolean(merchantId),
      merchantId,
      merchantKeyConfigured: Boolean(process.env.PAYFAST_MERCHANT_KEY?.trim()),
      businessEmail: process.env.PAYFAST_NOTIFY_EMAIL?.trim() || null,
      gatewayMode: process.env.PAYFAST_SANDBOX === "true" ? "sandbox" : "live",
      itnWebhookUrl: process.env.APP_URL ? `${process.env.APP_URL.replace(/\/$/, "")}/api/webhooks/payfast` : null,
      portalUrl: "https://www.payfast.co.za/user/login"
    });
  });
  app.use("/api", (err, _req, res, _next) => {
    console.error("API error:", err);
    if (res.headersSent) return;
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : "Internal error" });
  });
  if (!IS_SERVERLESS) {
    if (process.env.NODE_ENV !== "production") {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true, allowedHosts: true },
        appType: "spa"
      });
      app.use(vite.middlewares);
    } else {
      const distPath = path.join(process.cwd(), "dist");
      app.use(express.static(distPath, { index: false, maxAge: "1h" }));
      app.get("*", (_req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    }
  }
  return app;
}
async function startServer() {
  const app = await createApp();
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`AetherMail server running on http://0.0.0.0:${PORT}`);
  });
  if (process.env.BACKGROUND_SYNC !== "false") {
    ensureSchema().then(
      startBackgroundSync,
      (err) => console.error("[sync] background sync not started \u2014 database unavailable:", err.message)
    );
  }
}
var isDirectExecution = process.argv[1] && (process.argv[1].endsWith("server.ts") || process.argv[1].endsWith("server.cjs") || process.argv[1].endsWith("server.js"));
if (isDirectExecution && !process.env.VERCEL && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
  void startServer();
}

// src/server/vercel-handler.ts
var appPromise = null;
async function handler(req, res) {
  if (!appPromise) appPromise = createApp();
  const app = await appPromise;
  return app(req, res);
}
export {
  handler as default
};
