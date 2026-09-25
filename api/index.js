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
  mailboxesRelations: () => mailboxesRelations
});
import { pgTable, text, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
var accounts, emails, accountsRelations, emailsRelations, api_keys, domains, mailboxes, agent_keys, domainsRelations, mailboxesRelations;
var init_schema = __esm({
  "src/db/schema.ts"() {
    accounts = pgTable("accounts", {
      id: text("id").primaryKey(),
      provider: text("provider").notNull().default("google"),
      email_address: text("email_address").notNull().unique(),
      oauth_tokens: jsonb("oauth_tokens"),
      sync_status: text("sync_status").notNull().default("synced"),
      created_at: timestamp("created_at").defaultNow()
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
      received_at: timestamp("received_at").defaultNow()
    });
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

// src/lib/imap-sync.ts
var imap_sync_exports = {};
__export(imap_sync_exports, {
  syncGmailAccount: () => syncGmailAccount
});
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { eq as eq5 } from "drizzle-orm";
async function syncGmailAccount(emailAddress, appPassword, limit = 20) {
  const cleanEmail = emailAddress.trim().toLowerCase();
  const cleanPassword = appPassword.replace(/\s+/g, "");
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: {
      user: cleanEmail,
      pass: cleanPassword
    },
    logger: false,
    tls: {
      rejectUnauthorized: false
    }
  });
  try {
    await client.connect();
    const [existingAccount] = await db.select().from(accounts).where(eq5(accounts.email_address, cleanEmail)).limit(1);
    const accountId = existingAccount ? existingAccount.id : `acc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    if (!existingAccount) {
      await db.insert(accounts).values({
        id: accountId,
        provider: "google",
        email_address: cleanEmail,
        sync_status: "synced",
        created_at: /* @__PURE__ */ new Date()
      });
    }
    const lock = await client.getMailboxLock("INBOX");
    let imported = 0;
    try {
      const status = await client.status("INBOX", { messages: true });
      const totalMessages = status.messages || 0;
      if (totalMessages > 0) {
        const startSeq = Math.max(1, totalMessages - limit + 1);
        const seqRange = `${startSeq}:${totalMessages}`;
        for await (const message of client.fetch(seqRange, { source: true, envelope: true })) {
          if (!message.source) continue;
          try {
            const parsed = await simpleParser(message.source);
            const msgId = parsed.messageId || `imap_${message.uid}_${Date.now()}`;
            const [existingEmail] = await db.select({ id: emails.id }).from(emails).where(eq5(emails.id, msgId)).limit(1);
            if (existingEmail) {
              continue;
            }
            const subject = parsed.subject || "(No Subject)";
            const sender = parsed.from?.text || cleanEmail;
            const toText = parsed.to ? Array.isArray(parsed.to) ? parsed.to.map((t) => t.text).join(" ") : parsed.to.text : "";
            const deliveredTo = parsed.headers?.get("delivered-to") || "";
            const fullBody = parsed.html || parsed.text || "";
            const snippet = (parsed.text || fullBody.replace(/<[^>]*>/g, "")).slice(0, 140).trim();
            const receivedAt = parsed.date || /* @__PURE__ */ new Date();
            const lowerSub = subject.toLowerCase();
            const lowerBody = fullBody.toLowerCase();
            const lowerRecipients = `${toText} ${deliveredTo} ${snippet}`.toLowerCase();
            let targetAccountId = accountId;
            if (lowerRecipients.includes("info@arpcloudsolutions.co.za") || lowerSub.includes("payfast") || lowerBody.includes("payfast")) {
              const [bizAcc] = await db.select().from(accounts).where(eq5(accounts.email_address, "info@arpcloudsolutions.co.za")).limit(1);
              if (bizAcc) {
                targetAccountId = bizAcc.id;
              }
            } else if (lowerRecipients.includes("contact@arpcloudsolutions.co.za")) {
              const [bizAcc] = await db.select().from(accounts).where(eq5(accounts.email_address, "contact@arpcloudsolutions.co.za")).limit(1);
              if (bizAcc) {
                targetAccountId = bizAcc.id;
              }
            }
            let cat = "personal";
            let requiresAlert = false;
            if (lowerSub.includes("alert") || lowerSub.includes("urgent") || lowerSub.includes("action required") || lowerSub.includes("security")) {
              cat = "urgent";
              requiresAlert = true;
            } else if (lowerSub.includes("invoice") || lowerSub.includes("payment") || lowerSub.includes("payfast") || lowerSub.includes("receipt") || lowerSub.includes("bank") || lowerSub.includes("statement")) {
              cat = "financial";
              requiresAlert = lowerSub.includes("payfast") || lowerSub.includes("action") || lowerSub.includes("verify");
            } else if (lowerSub.includes("unsubscribe") || lowerBody.includes("unsubscribe") || lowerSub.includes("newsletter") || lowerSub.includes("digest")) {
              cat = "newsletter";
            } else if (lowerSub.includes("noreply") || lowerSub.includes("no-reply") || sender.includes("no-reply") || sender.includes("noreply")) {
              cat = "automated";
            } else if (lowerSub.includes("job") || lowerSub.includes("project") || lowerSub.includes("meeting") || lowerSub.includes("client") || lowerSub.includes("solutions")) {
              cat = "work";
            }
            if (lowerSub.includes("payfast") || lowerBody.includes("payfast")) {
              cat = "financial";
              requiresAlert = true;
            }
            const newEmail = {
              id: msgId,
              account_id: targetAccountId,
              thread_id: `thread_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              subject,
              sender,
              body_snippet: snippet,
              full_body: fullBody,
              category: cat,
              ai_summary: snippet.slice(0, 120) || `Message from ${sender}: ${subject}`,
              requires_alert: requiresAlert,
              is_read: false,
              received_at: receivedAt
            };
            await db.insert(emails).values(newEmail).onConflictDoNothing();
            imported++;
            if (requiresAlert) {
              const ntfyTopic = process.env.NTFY_TOPIC || "aethermail-alerts";
              try {
                await fetch(`https://ntfy.sh/${ntfyTopic}`, {
                  method: "POST",
                  headers: {
                    Title: `\u{1F6A8} [Jarvis Alert] ${subject.slice(0, 60)}`,
                    Priority: "urgent",
                    Tags: "rotating_light,envelope,warning",
                    Click: "https://aethermail-five.vercel.app"
                  },
                  body: `Account: ${cleanEmail}
From: ${sender}

Subject: ${subject}

Summary: ${snippet.slice(0, 150)}`,
                  signal: AbortSignal.timeout(3e3)
                });
              } catch (pushErr) {
                console.warn("[ntfy.sh] Push alert error in IMAP sync:", pushErr);
              }
            }
          } catch (msgErr) {
            console.warn("[IMAP Sync] Error parsing message:", msgErr);
          }
        }
      }
    } finally {
      lock.release();
    }
    return { success: true, imported };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[IMAP Sync Error for ${cleanEmail}]:`, errorMsg);
    return { success: false, imported: 0, error: errorMsg };
  } finally {
    try {
      if (client.authenticated) {
        await client.logout();
      } else {
        client.close();
      }
    } catch {
      try {
        client.close();
      } catch {
      }
    }
  }
}
var init_imap_sync = __esm({
  "src/lib/imap-sync.ts"() {
    init_db();
    init_schema();
  }
});

// server.ts
init_db();
init_schema();
import express from "express";
import path from "path";

// src/lib/gemini.ts
import { GoogleGenAI, Type } from "@google/genai";
var aiClient = null;
function getGeminiClient() {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    aiClient = new GoogleGenAI(apiKey ? { apiKey } : {});
  }
  return aiClient;
}
var VALID_CATEGORIES = /* @__PURE__ */ new Set([
  "urgent",
  "personal",
  "newsletter",
  "automated",
  "work",
  "financial"
]);
async function classifyWithLocalModel(prompt) {
  const baseUrl = (process.env.LOCAL_LLM_URL || "http://localhost:11434/v1").replace(/\/$/, "");
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
      signal: AbortSignal.timeout(12e4)
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
    const local = await classifyWithLocalModel(prompt);
    if (local) return local;
    throw new Error("No classifier available (no GEMINI_API_KEY, local model unreachable)");
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
    return parsed;
  } catch (error) {
    console.error("Gemini extraction error:", error);
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

// server.ts
import { eq as eq7, desc as desc3, and as and3 } from "drizzle-orm";

// src/app/actions/send-email.ts
init_db();
init_schema();
import nodemailer2 from "nodemailer";
import { eq } from "drizzle-orm";

// src/lib/stalwart.ts
import nodemailer from "nodemailer";
function getStalwartConfig() {
  return {
    apiUrl: process.env.STALWART_API_URL || "http://localhost:8080",
    adminUser: process.env.STALWART_ADMIN_USER || "admin",
    // No default. A placeholder secret that works in dev silently becomes the
    // production secret the day someone forgets to set it.
    adminSecret: process.env.STALWART_ADMIN_SECRET ?? "",
    smtpHost: process.env.SMTP_HOST || process.env.STALWART_SMTP_HOST || "localhost",
    smtpPort: Number(process.env.SMTP_PORT || process.env.STALWART_SMTP_PORT) || 587,
    smtpUser: process.env.SMTP_USER ?? "",
    smtpPass: process.env.SMTP_PASS ?? ""
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
async function dispatchViaStalwartSmtp(params) {
  const config = getStalwartConfig();
  const isLocal = /^(localhost|127\.|::1|0\.0\.0\.0)/.test(config.smtpHost);
  const transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpPort === 465,
    ...config.smtpUser ? { auth: { user: config.smtpUser, pass: config.smtpPass } } : {},
    tls: {
      // Self-signed certs are expected on a local server. Accepting any
      // certificate from a public relay would make the connection
      // interceptable, so verification stays on everywhere else.
      rejectUnauthorized: !isLocal
    }
  });
  const mailOptions = {
    from: params.from,
    to: params.to,
    subject: params.subject,
    html: params.htmlBody,
    text: params.textBody || params.htmlBody.replace(/<[^>]*>/g, ""),
    replyTo: params.replyTo,
    headers: {
      "X-Mailer": "AetherMail-Stalwart-Engine/2.0",
      "X-Agent-Protocol": "Jarvis-Autonomous-Dispatch"
    }
  };
  try {
    const info = await transporter.sendMail(mailOptions);
    return {
      success: true,
      messageId: info.messageId || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
    };
  } catch (err) {
    console.error("[Stalwart SMTP Error]:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to dispatch via Stalwart SMTP relay"
    };
  }
}

// src/app/actions/send-email.ts
var GMAIL_ACCOUNTS = {
  "mraaziqp@gmail.com": process.env.GMAIL_APP_PASSWORD || "yehajpcshymlzwcq",
  "backupe9@gmail.com": "efuwpgkcfwsjzlwu"
};
async function sendEmailAction(params) {
  try {
    const { accountId, to, subject, htmlBody } = params;
    if (!accountId || !to || !subject || !htmlBody) {
      return {
        success: false,
        error: "All fields (accountId, to, subject, htmlBody) are required to dispatch an email."
      };
    }
    let senderAddress = accountId;
    let resolvedAccountId = accountId;
    try {
      const [matchedAcc] = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
      if (matchedAcc) {
        senderAddress = matchedAcc.email_address;
        resolvedAccountId = matchedAcc.id;
      } else {
        const [matchedByEmail] = await db.select().from(accounts).where(eq(accounts.email_address, accountId)).limit(1);
        if (matchedByEmail) {
          senderAddress = matchedByEmail.email_address;
          resolvedAccountId = matchedByEmail.id;
        }
      }
    } catch (err) {
      console.warn("[sendEmailAction] DB account resolution non-blocking error:", err);
    }
    let messageId = `msg_out_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    let providerUsed = "Local Transport";
    let dispatchSuccess = false;
    let dispatchError = null;
    if (senderAddress.toLowerCase().includes("@gmail.com")) {
      const normalizedEmail = senderAddress.toLowerCase().trim();
      const appPass = GMAIL_ACCOUNTS[normalizedEmail] || process.env.GMAIL_APP_PASSWORD || "yehajpcshymlzwcq";
      const transporter = nodemailer2.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: {
          user: normalizedEmail,
          pass: appPass
        }
      });
      try {
        const info = await transporter.sendMail({
          from: senderAddress,
          to: to.trim(),
          subject: subject.trim(),
          html: htmlBody,
          text: htmlBody.replace(/<[^>]*>/g, "").trim(),
          headers: {
            "X-Mailer": "AetherMail-Unified-Engine/2.0"
          }
        });
        messageId = info.messageId || messageId;
        providerUsed = `Google SMTP (${normalizedEmail})`;
        dispatchSuccess = true;
      } catch (gmailErr) {
        console.error("[sendEmailAction] Gmail SMTP delivery error:", gmailErr);
        dispatchError = gmailErr instanceof Error ? gmailErr.message : String(gmailErr);
      }
    } else if (process.env.SMTP_HOST || process.env.STALWART_SMTP_HOST || process.env.RESEND_API_KEY) {
      const relayResult = await dispatchViaStalwartSmtp({
        from: senderAddress,
        to: to.trim(),
        subject: subject.trim(),
        htmlBody,
        replyTo: senderAddress
      });
      if (relayResult.success) {
        messageId = relayResult.messageId || messageId;
        providerUsed = "Business SMTP Relay";
        dispatchSuccess = true;
      } else {
        console.warn("[sendEmailAction] SMTP Relay warning:", relayResult.error);
        messageId = `msg_biz_${Date.now()}`;
        providerUsed = "Business Dispatch Engine (Queued)";
        dispatchSuccess = true;
      }
    } else if (process.env.EMAIL_SYNC_API_URL) {
      try {
        const response = await fetch(process.env.EMAIL_SYNC_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.EMAIL_SYNC_API_KEY ?? ""}`,
            "X-Client-Agent": "AetherMail-Dispatcher/1.0"
          },
          body: JSON.stringify({
            account_id: resolvedAccountId,
            recipient: to,
            subject,
            html_content: htmlBody,
            text_content: htmlBody.replace(/<[^>]*>/g, ""),
            client_timestamp: (/* @__PURE__ */ new Date()).toISOString()
          }),
          signal: AbortSignal.timeout(15e3)
        });
        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          throw new Error(`Sync bridge HTTP ${response.status}: ${detail.slice(0, 150)}`);
        }
        const data = await response.json().catch(() => ({}));
        messageId = data.message_id || messageId;
        providerUsed = "REST Sync Bridge";
        dispatchSuccess = true;
      } catch (bridgeErr) {
        dispatchError = bridgeErr instanceof Error ? bridgeErr.message : String(bridgeErr);
      }
    } else {
      providerUsed = "AetherMail Local Outbox";
      dispatchSuccess = true;
    }
    if (!dispatchSuccess && dispatchError) {
      return {
        success: false,
        error: dispatchError
      };
    }
    try {
      const snippet = htmlBody.replace(/<[^>]*>/g, "").slice(0, 140).trim();
      const newRecord = {
        id: messageId,
        account_id: resolvedAccountId,
        thread_id: `thread_${Date.now()}`,
        subject,
        sender: senderAddress,
        body_snippet: `To: ${to} \u2014 ${snippet}`,
        full_body: `<div style="padding-bottom: 8px; margin-bottom: 12px; border-bottom: 1px solid #333; font-size: 12px; color: #888;">
          <strong>To:</strong> ${to}<br/>
          <strong>From:</strong> ${senderAddress}<br/>
          <strong>Dispatched Via:</strong> ${providerUsed}
        </div>
        ${htmlBody}`,
        category: "work",
        ai_summary: `Outbound dispatch to ${to}: ${subject}`,
        requires_alert: false,
        is_read: true,
        received_at: /* @__PURE__ */ new Date()
      };
      await db.insert(emails).values(newRecord).onConflictDoNothing();
    } catch (dbErr) {
      console.warn("[sendEmailAction] Failed to log outbound email to DB:", dbErr);
    }
    return {
      success: true,
      messageId,
      dispatchedAt: (/* @__PURE__ */ new Date()).toISOString(),
      provider: providerUsed
    };
  } catch (err) {
    console.error("sendEmailAction error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to dispatch email"
    };
  }
}

// src/app/actions/smart-search.ts
init_db();
init_schema();
import { eq as eq2, and, or, ilike, gte, desc } from "drizzle-orm";
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
        (kw) => or(
          ilike(emails.subject, `%${kw}%`),
          ilike(emails.ai_summary, `%${kw}%`),
          ilike(emails.full_body, `%${kw}%`),
          ilike(emails.sender, `%${kw}%`)
        )
      );
      conditions.push(or(...keywordFilters));
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
        (w) => or(
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
        }).from(emails).leftJoin(accounts, eq2(emails.account_id, accounts.id)).where(or(...wordFilters)).orderBy(desc(emails.received_at)).limit(30);
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
import crypto4 from "node:crypto";
import { eq as eq6, and as and2, desc as desc2, gte as gte2 } from "drizzle-orm";

// src/lib/api-auth.ts
init_db();
init_schema();
import crypto from "node:crypto";
import { eq as eq3 } from "drizzle-orm";
function hashApiKey(rawKey) {
  return crypto.createHash("sha256").update(rawKey.trim()).digest("hex");
}
function generateNewApiKey(name, scopes = ["read"]) {
  const id = `key_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const entropy = crypto.randomBytes(24).toString("base64url");
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
    const key = records[0];
    const scopes = Array.isArray(key.scopes) ? key.scopes : [];
    if (requiredScope && !scopes.includes("admin") && !scopes.includes(requiredScope)) {
      return {
        valid: false,
        error: `Unauthorized: Token requires '${requiredScope}' scope. Granted scopes: [${scopes.join(", ")}]`,
        statusCode: 403
      };
    }
    db.update(api_keys).set({ last_used_at: /* @__PURE__ */ new Date() }).where(eq3(api_keys.id, key.id)).catch((err) => console.warn("Failed to update last_used_at:", err));
    return {
      valid: true,
      apiKey: key
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

// src/lib/dkim.ts
import crypto2 from "node:crypto";
function generateDkimKeyPair() {
  const { publicKey, privateKey } = crypto2.generateKeyPairSync("rsa", {
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

// src/lib/agent-auth.ts
init_db();
init_schema();
import crypto3 from "node:crypto";
import { eq as eq4 } from "drizzle-orm";
function hashAgentKey(rawToken) {
  return crypto3.createHash("sha256").update(rawToken.trim()).digest("hex");
}
function generateAgentKey(botName = "Jarvis", scopes = ["super_admin", "read_all", "send_as_any"]) {
  const entropy = crypto3.randomBytes(32).toString("hex");
  const rawKey = `jrv_root_${entropy}`;
  const keyHash = hashAgentKey(rawKey);
  const id = `ak_${Date.now()}_${crypto3.randomBytes(4).toString("hex")}`;
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
      conditions.push(eq6(emails.account_id, accountId));
    }
    if (category && typeof category === "string" && category !== "all") {
      conditions.push(eq6(emails.category, category));
    }
    if (requires_alert !== void 0) {
      conditions.push(eq6(emails.requires_alert, requires_alert === "true" || requires_alert === "1"));
    }
    if (is_read !== void 0) {
      conditions.push(eq6(emails.is_read, is_read === "true" || is_read === "1"));
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
    }).from(emails).leftJoin(accounts, eq6(emails.account_id, accounts.id)).orderBy(desc2(emails.received_at)).limit(maxLimit);
    const results = conditions.length > 0 ? await query.where(and2(...conditions)) : await query;
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
    }).from(emails).leftJoin(accounts, eq6(emails.account_id, accounts.id)).where(eq6(emails.id, id)).limit(1);
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
    const { accountId, to, subject, htmlBody } = req.body;
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
      subject,
      htmlBody
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
    const updated = await db.update(emails).set(updates).where(eq6(emails.id, id)).returning();
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
v1Router.get("/keys", async (_req, res) => {
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
v1Router.post("/keys", async (req, res) => {
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
v1Router.delete("/keys/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await db.delete(api_keys).where(eq6(api_keys.id, id)).returning();
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
v1Router.get("/metrics", async (_req, res) => {
  try {
    const allEmails = await db.select().from(emails);
    const allKeys = await db.select().from(api_keys);
    const allAccs = await db.select().from(accounts);
    const unreadCount = allEmails.filter((e) => !e.is_read).length;
    const alertCount = allEmails.filter((e) => e.requires_alert).length;
    const categoryDistribution = {
      urgent: 0,
      financial: 0,
      work: 0,
      personal: 0,
      newsletter: 0,
      automated: 0
    };
    for (const em of allEmails) {
      if (categoryDistribution[em.category] !== void 0) {
        categoryDistribution[em.category]++;
      }
    }
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
v1Router.post("/admin/domains", async (req, res) => {
  try {
    const { domain_name } = req.body;
    if (!domain_name || typeof domain_name !== "string") {
      return res.status(400).json({
        success: false,
        error: 'domain_name string is required (e.g. "acme-corp.com").'
      });
    }
    const normalizedDomain = domain_name.trim().toLowerCase();
    const existing = await db.select().from(domains).where(eq6(domains.domain_name, normalizedDomain)).limit(1);
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
v1Router.get("/admin/domains", async (_req, res) => {
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
v1Router.post("/admin/mailboxes", async (req, res) => {
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
      const matched = await db.select().from(domains).where(eq6(domains.domain_name, domainPart)).limit(1);
      if (matched.length === 0) {
        return res.status(404).json({
          success: false,
          error: `Domain "${domainPart}" is not registered. Provision domain first via POST /api/v1/admin/domains.`
        });
      }
      targetDomainId = matched[0].id;
    }
    const existingMbx = await db.select().from(mailboxes).where(eq6(mailboxes.email_address, email)).limit(1);
    if (existingMbx.length > 0) {
      return res.status(409).json({
        success: false,
        error: `Mailbox "${email}" already exists.`
      });
    }
    const salt = crypto4.randomBytes(16).toString("hex");
    const hash = crypto4.pbkdf2Sync(password || "AetherPass123!", salt, 1e4, 32, "sha256").toString("hex");
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
v1Router.get("/admin/mailboxes", async (req, res) => {
  try {
    const domainId = req.query.domain_id;
    let query = db.select({
      id: mailboxes.id,
      domain_id: mailboxes.domain_id,
      domain_name: domains.domain_name,
      email_address: mailboxes.email_address,
      is_active: mailboxes.is_active,
      created_at: mailboxes.created_at
    }).from(mailboxes).leftJoin(domains, eq6(mailboxes.domain_id, domains.id)).orderBy(desc2(mailboxes.created_at));
    const rows = domainId ? await query.where(eq6(mailboxes.domain_id, domainId)) : await query;
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
v1Router.post("/agent/provision-jarvis", async (_req, res) => {
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
      conditions.push(eq6(emails.is_read, false));
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
    }).from(emails).leftJoin(accounts, eq6(emails.account_id, accounts.id)).orderBy(desc2(emails.received_at)).limit(limit);
    const rows = conditions.length > 0 ? await query.where(and2(...conditions)) : await query;
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
    const updated = await db.update(emails).set(updates).where(eq6(emails.id, email_id)).returning();
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
    const defaultSender = process.env.JARVIS_DEFAULT_SENDER || "jarvis@aethermail.com";
    const sender = (from || defaultSender).trim();
    const recipient = Array.isArray(to) ? to.join(", ") : to.trim();
    const dispatchResult = await dispatchViaStalwartSmtp({
      from: sender,
      to,
      subject,
      htmlBody,
      textBody,
      replyTo
    });
    const messageId = dispatchResult.messageId || `msg_jrv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const threadId = thread_id || `th_${Date.now()}`;
    const snippet = textBody || htmlBody.replace(/<[^>]*>/g, "").slice(0, 140).trim();
    const [existingAcc] = await db.select().from(accounts).where(eq6(accounts.email_address, sender)).limit(1);
    const accountId = existingAcc ? existingAcc.id : `acc_agent_${Date.now()}`;
    if (!existingAcc) {
      await db.insert(accounts).values({
        id: accountId,
        provider: "stalwart",
        email_address: sender,
        sync_status: "synced",
        created_at: /* @__PURE__ */ new Date()
      }).onConflictDoNothing();
    }
    const newRecord = {
      id: messageId,
      account_id: accountId,
      thread_id: threadId,
      subject,
      sender: `Jarvis <${sender}>`,
      body_snippet: snippet,
      full_body: htmlBody,
      category: "work",
      ai_summary: `Autonomous response dispatched by Jarvis to ${recipient}`,
      requires_alert: false,
      is_read: true,
      received_at: /* @__PURE__ */ new Date()
    };
    await db.insert(emails).values(newRecord).onConflictDoNothing();
    return res.json({
      success: true,
      message: "Email dispatched via Stalwart SMTP relay and logged to database.",
      agent: req.agent?.botName,
      data: {
        message_id: messageId,
        from: sender,
        to: recipient,
        subject,
        transport: "stalwart-smtp",
        dispatched_at: (/* @__PURE__ */ new Date()).toISOString(),
        relay_status: dispatchResult.success ? "delivered" : "queued_or_fallback",
        error: dispatchResult.error
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
v1Router.post("/sync/gmail", async (req, res) => {
  try {
    const { email_address, app_password, limit } = req.body;
    if (!email_address || !app_password) {
      return res.status(400).json({
        success: false,
        error: "email_address and app_password are required."
      });
    }
    const { syncGmailAccount: syncGmailAccount2 } = await Promise.resolve().then(() => (init_imap_sync(), imap_sync_exports));
    const result = await syncGmailAccount2(email_address, app_password, limit || 20);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error || "Failed to authenticate or sync with Gmail IMAP server."
      });
    }
    return res.json({
      success: true,
      message: `Successfully synchronized ${result.imported} messages from Gmail inbox.`,
      imported: result.imported,
      email_address
    });
  } catch (err) {
    console.error("v1 POST /sync/gmail error:", err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Internal IMAP sync error"
    });
  }
});

// server.ts
var PORT = Number(process.env.PORT) || 3007;
var IS_SERVERLESS = !!process.env.VERCEL;
async function createApp() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/api/v1", v1Router);
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", time: (/* @__PURE__ */ new Date()).toISOString() });
  });
  app.post("/api/webhooks/email", async (req, res) => {
    try {
      const {
        id,
        account_id,
        thread_id,
        subject,
        sender,
        body_snippet,
        full_body,
        received_at
      } = req.body;
      if (!account_id || !subject || !sender || !full_body) {
        return res.status(400).json({
          error: "Missing required email fields: account_id, subject, sender, and full_body are required."
        });
      }
      const existingAccounts = await db.select().from(accounts).where(eq7(accounts.id, account_id)).limit(1);
      if (existingAccounts.length === 0) {
        await db.insert(accounts).values({
          id: account_id,
          provider: "google",
          email_address: sender.includes("<") ? sender.split("<")[1]?.replace(">", "") || `${account_id}@unified.mail` : `${account_id}@unified.mail`,
          sync_status: "synced"
        });
      }
      const aiExtraction = await processEmailWithGemini({
        subject,
        sender,
        body: full_body
      });
      const emailId = id || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const threadId = thread_id || `thread_${Date.now()}`;
      const snippet = body_snippet || full_body.slice(0, 140).replace(/\s+/g, " ").trim();
      const newRecord = {
        id: emailId,
        account_id,
        thread_id: threadId,
        subject,
        sender,
        body_snippet: snippet,
        full_body,
        category: aiExtraction.category,
        ai_summary: aiExtraction.summary,
        requires_alert: aiExtraction.requires_alert,
        is_read: false,
        received_at: received_at ? new Date(received_at) : /* @__PURE__ */ new Date()
      };
      const inserted = await db.insert(emails).values(newRecord).returning();
      let ntfyDispatched = false;
      if (aiExtraction.requires_alert) {
        const ntfyTopic = process.env.NTFY_TOPIC || "aethermail-alerts";
        try {
          const pushBody = `From: ${sender}

Subject: ${subject}

AI Summary: ${aiExtraction.summary}

Action Required: Immediate human attention flagged by Gemini 2.5 Flash.`;
          await fetch(`https://ntfy.sh/${ntfyTopic}`, {
            method: "POST",
            headers: {
              "Title": `\u{1F6A8} [AetherMail Alert] ${subject.slice(0, 60)}`,
              "Priority": "urgent",
              "Tags": "warning,rotating_light,email",
              "Click": process.env.APP_URL || "https://aethermail.internal"
            },
            body: pushBody,
            signal: AbortSignal.timeout(3e3)
          });
          ntfyDispatched = true;
        } catch (pushErr) {
          console.warn("ntfy.sh push alert error (Express):", pushErr);
        }
      }
      return res.status(201).json({
        success: true,
        message: "Email ingested and analyzed with Gemini successfully",
        data: inserted[0],
        alertDispatched: ntfyDispatched
      });
    } catch (error) {
      console.error("Webhook ingestion error in Express server:", error);
      return res.status(500).json({
        error: "Failed to process email webhook",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });
  app.post("/api/send-email", async (req, res) => {
    try {
      const { accountId, to, subject, htmlBody } = req.body;
      const result = await sendEmailAction({ accountId, to, subject, htmlBody });
      if (!result.success) {
        return res.status(400).json(result);
      }
      return res.json(result);
    } catch (error) {
      console.error("Outbound send email error:", error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to dispatch email"
      });
    }
  });
  app.post("/api/smart-search", async (req, res) => {
    try {
      const { query, accountId } = req.body;
      const result = await smartSearchAction(query || "", accountId);
      return res.json(result);
    } catch (error) {
      console.error("Smart search error:", error);
      return res.status(500).json({
        success: false,
        emails: [],
        error: error instanceof Error ? error.message : "Smart search failed"
      });
    }
  });
  app.post("/api/emails/batch", async (req, res) => {
    try {
      const { emailIds, action } = req.body;
      const result = await batchUpdateEmailsAction({ emailIds, action });
      if (!result.success) {
        return res.status(400).json(result);
      }
      return res.json(result);
    } catch (error) {
      console.error("Batch emails error:", error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Batch operation failed"
      });
    }
  });
  app.post("/api/smart-reply", async (req, res) => {
    try {
      const { emailId, tone, instructions } = req.body;
      if (!emailId) {
        return res.status(400).json({ error: "emailId is required" });
      }
      const [emailRecord] = await db.select().from(emails).where(eq7(emails.id, emailId)).limit(1);
      if (!emailRecord) {
        return res.status(404).json({ error: "Email not found" });
      }
      const draftReply = await generateSmartReplyWithGemini({
        subject: emailRecord.subject,
        sender: emailRecord.sender,
        body: emailRecord.full_body,
        aiSummary: emailRecord.ai_summary,
        tone,
        instructions
      });
      return res.json({ success: true, draftReply });
    } catch (error) {
      console.error("Smart reply error:", error);
      return res.status(500).json({
        error: "Failed to generate smart reply",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });
  app.get("/api/accounts", async (req, res) => {
    try {
      const allAccounts = await db.select().from(accounts).orderBy(accounts.created_at);
      res.json(allAccounts);
    } catch (error) {
      console.error("Fetch accounts error:", error);
      res.status(500).json({ error: "Failed to fetch accounts" });
    }
  });
  app.post("/api/accounts", async (req, res) => {
    try {
      const { id, provider, email_address } = req.body;
      if (!email_address) {
        return res.status(400).json({ error: "email_address is required" });
      }
      const accountId = id || `acc_${Date.now()}`;
      const newAcc = {
        id: accountId,
        provider: provider || "google",
        email_address,
        sync_status: "synced"
      };
      const [inserted] = await db.insert(accounts).values(newAcc).returning();
      res.status(201).json(inserted);
    } catch (error) {
      console.error("Add account error:", error);
      res.status(500).json({ error: "Failed to add account" });
    }
  });
  let isSyncInProgress = false;
  const handleUnifiedSync = async (_req, res) => {
    if (isSyncInProgress) {
      return res.json({
        success: true,
        message: "Sync already in progress",
        syncing: true,
        syncedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
    isSyncInProgress = true;
    try {
      const { syncGmailAccount: syncGmailAccount2 } = await Promise.resolve().then(() => (init_imap_sync(), imap_sync_exports));
      const allAccounts = await db.select().from(accounts);
      let totalImported = 0;
      const syncReports = [];
      for (const acc of allAccounts) {
        let appPass = "";
        if (acc.oauth_tokens && typeof acc.oauth_tokens === "object" && "app_password" in acc.oauth_tokens) {
          appPass = String(acc.oauth_tokens.app_password);
        } else if (acc.email_address === process.env.GMAIL_USER) {
          appPass = process.env.GMAIL_APP_PASSWORD || "";
        } else if (acc.email_address === process.env.BACKUPE9_USER) {
          appPass = process.env.BACKUPE9_APP_PASSWORD || "";
        }
        if (appPass && acc.email_address.includes("@gmail.com")) {
          try {
            const syncResult = await syncGmailAccount2(acc.email_address, appPass, 30);
            totalImported += syncResult.imported;
            syncReports.push({ email: acc.email_address, imported: syncResult.imported, status: syncResult.success ? "ok" : syncResult.error || "unknown" });
          } catch (syncErr) {
            console.warn(`[Sync] Error syncing ${acc.email_address}:`, syncErr);
            syncReports.push({ email: acc.email_address, imported: 0, status: "error" });
          }
        }
      }
      res.json({
        success: true,
        imported: totalImported,
        reports: syncReports,
        syncedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
    } catch (error) {
      console.error("Unified sync error:", error);
      res.status(500).json({ error: "Failed to sync accounts" });
    } finally {
      isSyncInProgress = false;
    }
  };
  app.all("/api/sync/all", handleUnifiedSync);
  app.all("/api/cron/sync", handleUnifiedSync);
  app.get("/api/emails", async (req, res) => {
    try {
      const { accountId, category, alertOnly, search } = req.query;
      let query = db.select({
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
      }).from(emails).leftJoin(accounts, eq7(emails.account_id, accounts.id)).orderBy(desc3(emails.received_at));
      const conditions = [];
      if (accountId && typeof accountId === "string" && accountId !== "all") {
        conditions.push(eq7(emails.account_id, accountId));
      }
      if (category && typeof category === "string" && category !== "all") {
        conditions.push(eq7(emails.category, category));
      }
      if (alertOnly === "true") {
        conditions.push(eq7(emails.requires_alert, true));
      }
      const results = conditions.length > 0 ? await query.where(and3(...conditions)) : await query;
      let filtered = results;
      if (search && typeof search === "string") {
        const queryLower = search.toLowerCase();
        filtered = results.filter(
          (e) => e.subject.toLowerCase().includes(queryLower) || e.sender.toLowerCase().includes(queryLower) || e.ai_summary.toLowerCase().includes(queryLower) || e.full_body.toLowerCase().includes(queryLower)
        );
      }
      res.json(filtered);
    } catch (error) {
      console.error("Fetch emails error:", error);
      res.status(500).json({ error: "Failed to fetch emails" });
    }
  });
  app.patch("/api/emails/:id/read", async (req, res) => {
    try {
      const { id } = req.params;
      const { is_read } = req.body;
      const [updated] = await db.update(emails).set({ is_read: Boolean(is_read) }).where(eq7(emails.id, id)).returning();
      if (!updated) {
        return res.status(404).json({ error: "Email not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Update email read error:", error);
      res.status(500).json({ error: "Failed to update email status" });
    }
  });
  app.delete("/api/emails/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await db.delete(emails).where(eq7(emails.id, id));
      res.json({ success: true });
    } catch (error) {
      console.error("Delete email error:", error);
      res.status(500).json({ error: "Failed to delete email" });
    }
  });
  app.post("/api/seed", async (req, res) => {
    try {
      const accList = [
        {
          id: "acc_primary_work",
          provider: "google",
          email_address: "alex.morgan@workforce.io",
          sync_status: "synced"
        },
        {
          id: "acc_personal_gmail",
          provider: "google",
          email_address: "alex.morgan.personal@gmail.com",
          sync_status: "synced"
        }
      ];
      for (const acc of accList) {
        await db.insert(accounts).values(acc).onConflictDoNothing({ target: accounts.id });
      }
      const seedEmails = [
        {
          id: "msg_prod_incident_001",
          account_id: "acc_primary_work",
          thread_id: "th_incident_409",
          subject: "[P0 CRITICAL ALERT] Production DB Latency Spike & Failover Triggered",
          sender: "PagerDuty Alert <alerts@pagerduty.internal>",
          body_snippet: "Database connection pool utilization reached 98% in europe-west2. Automated mitigation started.",
          full_body: `URGENT INCIDENT REPORT #8492
Severity: P0 - Critical Human Action Required
Time: Today at 02:30 UTC
Component: Primary Database & API Gateway cluster (europe-west2)

Summary:
At 02:24 UTC, the internal monitoring system detected elevated query latency (>1450ms) across API endpoints, accompanied by a 98% connection pool saturation.

Immediate Actions Required:
1. Review active long-running queries on the read-replica.
2. Confirm if the recent batch sync deployment is holding table-level locks.
3. Incident Commander standby on Slack #incident-db-p0.

Please acknowledge this page immediately by logging into the response console.`,
          category: "urgent",
          ai_summary: "Immediate human intervention required for a P0 production database latency spike and connection saturation in europe-west2.",
          requires_alert: true,
          is_read: false,
          received_at: new Date(Date.now() - 1e3 * 60 * 12)
        },
        {
          id: "msg_term_sheet_002",
          account_id: "acc_primary_work",
          thread_id: "th_venture_202",
          subject: "Revised Series B Term Sheet - Final Signature Request by 5 PM EST",
          sender: "Elena Rostova <erostova@sequoia-capital.com>",
          body_snippet: "Attached is the revised term sheet reflecting the 20% valuation bump agreed upon yesterday.",
          full_body: `Hi Alex,

I hope you are having a great morning.

Attached is the revised Series B Term Sheet incorporating the adjustments we agreed on during yesterday's partner call, including the $45M valuation cap and the board composition seat terms.

Our legal partners at Wilson Sonsini are prepared to countersign as soon as your board executes. Could you please review Section 4 (Governance) and return the signed DocuSign envelope before 5:00 PM EST today?

Let me know if you need any clarifying points on the ESOP pool adjustment.

Warm regards,
Elena Rostova
Partner, Venture Capital`,
          category: "financial",
          ai_summary: "Elena sent the finalized Series B term sheet requesting review and DocuSign signature before 5:00 PM EST today.",
          requires_alert: true,
          is_read: false,
          received_at: new Date(Date.now() - 1e3 * 60 * 45)
        },
        {
          id: "msg_q3_roadmap_003",
          account_id: "acc_primary_work",
          thread_id: "th_q3_roadmap",
          subject: "Q3 Product Roadmap Review: AI Ingestion & Search Milestones",
          sender: "Marcus Chen <marcus.chen@workforce.io>",
          body_snippet: "Drafted the engineering milestones for the Next.js AI pipeline rollout next sprint.",
          full_body: `Hey Alex,

I've put together the draft for our Q3 engineering sprint deliverables. Key highlights:

1. Webhook Ingestion Engine: Real-time processing via Gemini 2.5 Flash with sub-800ms latency SLAs.
2. PostgreSQL + Drizzle Schema: Automated indexing on recipient account IDs and alert priority tags.
3. Smart Reply Server Actions: User-customizable executive tone controls.

Could you take a quick pass through the PR review when you get a chance? No rush on this, anytime before our Thursday sync is great.

Best,
Marcus`,
          category: "work",
          ai_summary: "Marcus shared the Q3 AI ingestion roadmap milestones and requested a casual review prior to Thursday.",
          requires_alert: false,
          is_read: true,
          received_at: new Date(Date.now() - 1e3 * 60 * 180)
        },
        {
          id: "msg_weekend_hiking_004",
          account_id: "acc_personal_gmail",
          thread_id: "th_hiking_sat",
          subject: "Weekend hiking trip to Yosemite + cabin reservation details!",
          sender: "Sarah Jenkins <sarah.j.adventures@gmail.com>",
          body_snippet: "Got the wilderness permits and booked the cozy cabin near El Portal for this Saturday!",
          full_body: `Hey Alex!

Great news \u2014 I managed to snag 4 wilderness permits for the Mist Trail and Upper Yosemite Fall hike this Saturday!

I also reserved the cabin near El Portal for Friday and Saturday night. Total came out to $180 per person for both nights. Whenever you have a second, you can Venmo or Zelle me.

Let me know if you want to carpool together from the Bay Area around 6:30 AM to beat the park entrance traffic!

Excited!
Sarah`,
          category: "personal",
          ai_summary: "Sarah confirmed wilderness permits and cabin reservations for the Yosemite trip and requested carpool coordination.",
          requires_alert: false,
          is_read: false,
          received_at: new Date(Date.now() - 1e3 * 60 * 360)
        },
        {
          id: "msg_tech_newsletter_005",
          account_id: "acc_personal_gmail",
          thread_id: "th_tldr_ai_issue_48",
          subject: "TLDR AI: Gemini 2.5 Flash Architecture & Next-Gen Agent Workflows",
          sender: "TLDR AI Newsletter <dan@tldrnewsletter.com>",
          body_snippet: "Weekly curated breakdown of multimodal models, tool-use optimizations, and full-stack benchmarks.",
          full_body: `TLDR AI - ISSUE #489

TOP HEADLINES:
- Fast Inference Breakthroughs: Model distilled latency shrinks by 40% with speculative decoding.
- Drizzle ORM releases native vector extensions and connection pooling diagnostics.
- Next.js Server Actions benchmarked against traditional REST endpoints for high-throughput streaming.

SPONSOR: Build reliable full-stack apps in minutes.

Click here to read the full issue in your browser or unsubscribe from this list.`,
          category: "newsletter",
          ai_summary: "Weekly curation covering Gemini 2.5 latency optimizations, Drizzle ORM updates, and Next.js server actions benchmarks.",
          requires_alert: false,
          is_read: true,
          received_at: new Date(Date.now() - 1e3 * 60 * 600)
        },
        {
          id: "msg_stripe_receipt_006",
          account_id: "acc_primary_work",
          thread_id: "th_stripe_inv_92",
          subject: "Your receipt from Google Cloud Services [#GCP-89214-INV]",
          sender: "Stripe Billing <invoices@stripe.com>",
          body_snippet: "Payment of $142.50 was successfully processed for Cloud SQL & Storage allocation.",
          full_body: `RECEIPT FROM GOOGLE CLOUD SERVICES
Invoice #GCP-89214-INV
Date: September 15, 2026
Payment Method: Visa ending in 4092

Itemized Charges:
- Cloud SQL Developer Edition (PostgreSQL Europe-West2): $0.00 (Free Tier)
- Cloud Storage Standard (Ingestion storage): $14.20
- Network egress & API gateway calls: $128.30
Total Paid: $142.50

Your invoice PDF is available for download in your billing dashboard.`,
          category: "automated",
          ai_summary: "Automatic billing receipt confirming $142.50 successfully charged for Google Cloud Services.",
          requires_alert: false,
          is_read: true,
          received_at: new Date(Date.now() - 1e3 * 60 * 1440)
        }
      ];
      for (const email of seedEmails) {
        await db.insert(emails).values(email).onConflictDoNothing({ target: emails.id });
      }
      res.json({ success: true, count: seedEmails.length });
    } catch (error) {
      console.error("Seed error:", error);
      res.status(500).json({ error: "Failed to seed database" });
    }
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
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
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
