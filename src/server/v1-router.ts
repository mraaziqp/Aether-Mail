import { Router, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import { db } from '../db/index.ts';
import { emails, accounts, api_keys, domains, mailboxes, agent_keys, type NewApiKey, type NewDomain, type NewMailbox, type NewAccount, type NewEmail } from '../db/schema.ts';
import { eq, and, desc, gte, sql } from 'drizzle-orm';
import { requireApiKey, generateNewApiKey } from '../lib/api-auth.ts';
import { sendEmailAction } from '../app/actions/send-email.ts';
import { generateDkimKeyPair, buildDomainDnsRecords } from '../lib/dkim.ts';
import { provisionStalwartDomain, provisionStalwartMailbox, dispatchViaStalwartSmtp } from '../lib/stalwart.ts';
import { requireAgentScope, ensureJarvisRootKey, generateAgentKey } from '../lib/agent-auth.ts';

export const v1Router = Router();

/**
 * GET /api/v1/emails
 * Root Programmatic Endpoint for External Bots and Agents to query emails
 * Supported query params: category, requires_alert, is_read, since, limit, accountId
 */
v1Router.get('/emails', requireApiKey('read'), async (req: Request, res: Response) => {
  try {
    const { category, requires_alert, is_read, since, limit, accountId } = req.query;

    const conditions = [];

    if (accountId && typeof accountId === 'string' && accountId !== 'all') {
      conditions.push(eq(emails.account_id, accountId));
    }

    if (category && typeof category === 'string' && category !== 'all') {
      conditions.push(eq(emails.category, category));
    }

    if (requires_alert !== undefined) {
      conditions.push(eq(emails.requires_alert, requires_alert === 'true' || requires_alert === '1'));
    }

    if (is_read !== undefined) {
      conditions.push(eq(emails.is_read, is_read === 'true' || is_read === '1'));
    }

    if (since && typeof since === 'string') {
      const sinceDate = new Date(isNaN(Number(since)) ? since : Number(since));
      if (!isNaN(sinceDate.getTime())) {
        conditions.push(gte(emails.received_at, sinceDate));
      }
    }

    const maxLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);

    const query = db
      .select({
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
        account_email: accounts.email_address,
      })
      .from(emails)
      .leftJoin(accounts, eq(emails.account_id, accounts.id))
      .orderBy(desc(emails.received_at))
      .limit(maxLimit);

    const results = conditions.length > 0 ? await query.where(and(...conditions)) : await query;

    return res.json({
      success: true,
      count: results.length,
      data: results.map((r) => ({
        ...r,
        received_at: r.received_at ? r.received_at.toISOString() : null,
      })),
    });
  } catch (error) {
    console.error('v1 GET /emails error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to query emails',
    });
  }
});

/**
 * GET /api/v1/emails/:id
 * Retrieve full email item by ID
 */
v1Router.get('/emails/:id', requireApiKey('read'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const results = await db
      .select({
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
        account_email: accounts.email_address,
      })
      .from(emails)
      .leftJoin(accounts, eq(emails.account_id, accounts.id))
      .where(eq(emails.id, id))
      .limit(1);

    if (results.length === 0) {
      return res.status(404).json({ success: false, error: `Email ${id} not found.` });
    }

    const row = results[0];
    return res.json({
      success: true,
      data: {
        ...row,
        received_at: row.received_at ? row.received_at.toISOString() : null,
      },
    });
  } catch (error) {
    console.error('v1 GET /emails/:id error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch email',
    });
  }
});

/**
 * POST /api/v1/emails/send
 * Outbound endpoint for bots and agents to dispatch emails via sync engine
 */
v1Router.post('/emails/send', requireApiKey('send'), async (req: Request, res: Response) => {
  try {
    const { accountId, to, subject, htmlBody } = req.body;

    if (!to || !subject || !htmlBody) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: to, subject, htmlBody.',
      });
    }

    // Default to first account if not provided
    let targetAccountId = accountId;
    if (!targetAccountId) {
      const accList = await db.select().from(accounts).limit(1);
      if (accList.length > 0) {
        targetAccountId = accList[0].id;
      } else {
        return res.status(400).json({
          success: false,
          error: 'No accounts configured in AetherMail to send from.',
        });
      }
    }

    const result = await sendEmailAction({
      accountId: targetAccountId,
      to,
      subject,
      htmlBody,
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.status(201).json(result);
  } catch (error) {
    console.error('v1 POST /emails/send error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Outbound dispatch failed',
    });
  }
});

/**
 * PATCH /api/v1/emails/:id
 * Programmatic triage for external bots (mark read, change category, toggle alerts)
 */
v1Router.patch('/emails/:id', requireApiKey('write'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { is_read, category, requires_alert } = req.body;

    const updates: Record<string, any> = {};
    if (typeof is_read === 'boolean') updates.is_read = is_read;
    if (typeof category === 'string') updates.category = category;
    if (typeof requires_alert === 'boolean') updates.requires_alert = requires_alert;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid update fields provided (is_read, category, requires_alert).',
      });
    }

    const updated = await db
      .update(emails)
      .set(updates)
      .where(eq(emails.id, id))
      .returning();

    if (updated.length === 0) {
      return res.status(404).json({ success: false, error: `Email ${id} not found.` });
    }

    return res.json({
      success: true,
      data: updated[0],
      message: `Email ${id} updated successfully.`,
    });
  } catch (error) {
    console.error('v1 PATCH /emails/:id error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update email',
    });
  }
});

/**
 * GET /api/v1/keys
 * List active API Keys (safe display without key_hash)
 */
v1Router.get('/keys', async (_req: Request, res: Response) => {
  try {
    const keys = await db
      .select({
        id: api_keys.id,
        name: api_keys.name,
        prefix: api_keys.prefix,
        scopes: api_keys.scopes,
        last_used_at: api_keys.last_used_at,
        created_at: api_keys.created_at,
      })
      .from(api_keys)
      .orderBy(desc(api_keys.created_at));

    return res.json({
      success: true,
      keys: keys.map((k) => ({
        ...k,
        last_used_at: k.last_used_at ? k.last_used_at.toISOString() : null,
        created_at: k.created_at ? k.created_at.toISOString() : null,
      })),
    });
  } catch (error) {
    console.error('v1 GET /keys error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list API keys',
    });
  }
});

/**
 * POST /api/v1/keys
 * Create and register a new scoped API Key
 */
v1Router.post('/keys', async (req: Request, res: Response) => {
  try {
    const { name, scopes } = req.body;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Key name is required.',
      });
    }

    const validScopes = ['read', 'write', 'send', 'admin'];
    const chosenScopes: string[] = Array.isArray(scopes) && scopes.length > 0
      ? scopes.filter((s) => validScopes.includes(s))
      : ['read'];

    const newKeyGen = generateNewApiKey(name.trim(), chosenScopes);

    const inserted = await db
      .insert(api_keys)
      .values({
        id: newKeyGen.id,
        name: newKeyGen.name,
        key_hash: newKeyGen.keyHash,
        prefix: newKeyGen.prefix,
        scopes: newKeyGen.scopes,
      })
      .returning();

    return res.status(201).json({
      success: true,
      key: {
        id: inserted[0].id,
        name: inserted[0].name,
        prefix: inserted[0].prefix,
        scopes: inserted[0].scopes,
        rawKey: newKeyGen.rawKey, // Returned ONLY ONCE on generation!
        created_at: inserted[0].created_at ? inserted[0].created_at.toISOString() : new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('v1 POST /keys error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate API key',
    });
  }
});

/**
 * DELETE /api/v1/keys/:id
 * Revoke an API Key
 */
v1Router.delete('/keys/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deleted = await db
      .delete(api_keys)
      .where(eq(api_keys.id, id))
      .returning();

    if (deleted.length === 0) {
      return res.status(404).json({ success: false, error: 'Key not found' });
    }

    return res.json({
      success: true,
      message: `API Key '${deleted[0].name}' (${deleted[0].prefix}) revoked successfully.`,
    });
  } catch (error) {
    console.error('v1 DELETE /keys/:id error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to revoke API key',
    });
  }
});

/**
 * GET /api/v1/metrics
 * System & API metrics for developer dashboard
 */
v1Router.get('/metrics', async (_req: Request, res: Response) => {
  try {
    const allEmails = await db.select().from(emails);
    const allKeys = await db.select().from(api_keys);
    const allAccs = await db.select().from(accounts);

    const unreadCount = allEmails.filter((e) => !e.is_read).length;
    const alertCount = allEmails.filter((e) => e.requires_alert).length;

    const categoryDistribution: Record<string, number> = {
      urgent: 0,
      financial: 0,
      work: 0,
      personal: 0,
      newsletter: 0,
      automated: 0,
    };

    for (const em of allEmails) {
      if (categoryDistribution[em.category] !== undefined) {
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
        syncStatus: allAccs.every((a) => a.sync_status === 'synced') ? 'synced' : 'syncing',
        lastUpdated: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('v1 GET /metrics error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to compute metrics',
    });
  }
});

// ============================================================================
// Business Email Provisioning Engine (Stalwart & Neon/PostgreSQL)
// ============================================================================

/**
 * POST /api/v1/admin/domains
 * Register domain, generate 2048-bit DKIM keypair, and return registrar DNS records
 */
v1Router.post('/admin/domains', async (req: Request, res: Response) => {
  try {
    const { domain_name } = req.body;
    if (!domain_name || typeof domain_name !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'domain_name string is required (e.g. "acme-corp.com").',
      });
    }

    const normalizedDomain = domain_name.trim().toLowerCase();

    const existing = await db
      .select()
      .from(domains)
      .where(eq(domains.domain_name, normalizedDomain))
      .limit(1);

    if (existing.length > 0) {
      const existingDomain = existing[0];
      const dnsConfig = buildDomainDnsRecords(existingDomain.domain_name, existingDomain.dkim_public_key);
      return res.json({
        success: true,
        message: 'Domain already registered. Retrieved existing DNS configuration.',
        domain: {
          id: existingDomain.id,
          domain_name: existingDomain.domain_name,
          is_verified: existingDomain.is_verified,
          created_at: existingDomain.created_at?.toISOString() || new Date().toISOString(),
          dns_records: dnsConfig.records,
        },
        instructions: 'Add these records to your domain registrar DNS settings to complete verification.',
      });
    }

    const dkim = generateDkimKeyPair();
    const dnsConfig = buildDomainDnsRecords(normalizedDomain, dkim.dnsTxtValue);
    const domainId = `dom_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const newDomainRecord: NewDomain = {
      id: domainId,
      domain_name: normalizedDomain,
      is_verified: false,
      dkim_private_key: dkim.privateKey,
      dkim_public_key: dkim.dnsTxtValue,
      dns_mx_record: dnsConfig.mxRecord,
      dns_spf_record: dnsConfig.spfRecord,
      created_at: new Date(),
    };

    const [inserted] = await db.insert(domains).values(newDomainRecord).returning();
    await provisionStalwartDomain(normalizedDomain);

    return res.status(201).json({
      success: true,
      domain: {
        id: inserted.id,
        domain_name: inserted.domain_name,
        is_verified: inserted.is_verified,
        created_at: inserted.created_at ? inserted.created_at.toISOString() : new Date().toISOString(),
        dns_records: dnsConfig.records,
      },
      instructions: 'Configure these DNS records with your registrar. Once DNS propagates, mailboxes can be activated.',
    });
  } catch (error) {
    console.error('v1 POST /admin/domains error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal domain provisioning failure',
    });
  }
});

/**
 * GET /api/v1/admin/domains
 * List registered domains with DNS bundle
 */
v1Router.get('/admin/domains', async (_req: Request, res: Response) => {
  try {
    const allDomains = await db.select().from(domains).orderBy(desc(domains.created_at));
    const enriched = allDomains.map((d) => {
      const dnsConfig = buildDomainDnsRecords(d.domain_name, d.dkim_public_key);
      return {
        id: d.id,
        domain_name: d.domain_name,
        is_verified: d.is_verified,
        created_at: d.created_at ? d.created_at.toISOString() : null,
        dns_records: dnsConfig.records,
      };
    });

    return res.json({
      success: true,
      count: enriched.length,
      domains: enriched,
    });
  } catch (error) {
    console.error('v1 GET /admin/domains error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list domains',
    });
  }
});

/**
 * POST /api/v1/admin/mailboxes
 * Provision virtual mailbox user in Stalwart and record in PostgreSQL
 */
v1Router.post('/admin/mailboxes', async (req: Request, res: Response) => {
  try {
    const { domain_id, email_address, password } = req.body;
    if (!email_address || !email_address.includes('@')) {
      return res.status(400).json({
        success: false,
        error: 'email_address is required (e.g. "contact@company.com").',
      });
    }

    const email = email_address.trim().toLowerCase();
    const domainPart = email.split('@')[1];

    let targetDomainId = domain_id;
    if (!targetDomainId) {
      const matched = await db
        .select()
        .from(domains)
        .where(eq(domains.domain_name, domainPart))
        .limit(1);

      if (matched.length === 0) {
        return res.status(404).json({
          success: false,
          error: `Domain "${domainPart}" is not registered. Provision domain first via POST /api/v1/admin/domains.`,
        });
      }
      targetDomainId = matched[0].id;
    }

    const existingMbx = await db
      .select()
      .from(mailboxes)
      .where(eq(mailboxes.email_address, email))
      .limit(1);

    if (existingMbx.length > 0) {
      return res.status(409).json({
        success: false,
        error: `Mailbox "${email}" already exists.`,
      });
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password || 'AetherPass123!', salt, 10000, 32, 'sha256').toString('hex');
    const pwdHash = `${salt}:${hash}`;

    await provisionStalwartMailbox(email, pwdHash);

    const mailboxId = `mbx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newMbx: NewMailbox = {
      id: mailboxId,
      domain_id: targetDomainId,
      email_address: email,
      password_hash: pwdHash,
      is_active: true,
      created_at: new Date(),
    };

    const [inserted] = await db.insert(mailboxes).values(newMbx).returning();

    await db
      .insert(accounts)
      .values({
        id: mailboxId,
        provider: 'stalwart',
        email_address: email,
        sync_status: 'synced',
        created_at: new Date(),
      })
      .onConflictDoNothing();

    return res.status(201).json({
      success: true,
      message: `Mailbox ${email} provisioned and activated successfully.`,
      mailbox: {
        id: inserted.id,
        domain_id: inserted.domain_id,
        email_address: inserted.email_address,
        is_active: inserted.is_active,
        created_at: inserted.created_at ? inserted.created_at.toISOString() : new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('v1 POST /admin/mailboxes error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to provision mailbox',
    });
  }
});

/**
 * GET /api/v1/admin/mailboxes
 * List provisioned virtual mailboxes
 */
v1Router.get('/admin/mailboxes', async (req: Request, res: Response) => {
  try {
    const domainId = req.query.domain_id as string | undefined;
    let query = db
      .select({
        id: mailboxes.id,
        domain_id: mailboxes.domain_id,
        domain_name: domains.domain_name,
        email_address: mailboxes.email_address,
        is_active: mailboxes.is_active,
        created_at: mailboxes.created_at,
      })
      .from(mailboxes)
      .leftJoin(domains, eq(mailboxes.domain_id, domains.id))
      .orderBy(desc(mailboxes.created_at));

    const rows = domainId ? await query.where(eq(mailboxes.domain_id, domainId)) : await query;

    return res.json({
      success: true,
      count: rows.length,
      mailboxes: rows.map((m) => ({
        ...m,
        created_at: m.created_at ? m.created_at.toISOString() : null,
      })),
    });
  } catch (error) {
    console.error('v1 GET /admin/mailboxes error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list mailboxes',
    });
  }
});

// ============================================================================
// Jarvis Root-Access Agent Protocol
// ============================================================================

/**
 * POST /api/v1/agent/provision-jarvis
 * Returns or provisions the Jarvis master root key
 */
v1Router.post('/agent/provision-jarvis', async (_req: Request, res: Response) => {
  try {
    const result = await ensureJarvisRootKey();
    return res.json({
      success: true,
      message: result.rawKey
        ? 'New Jarvis root master key provisioned. Save the raw key securely!'
        : 'Jarvis root key exists in database.',
      agent: {
        id: result.keyInfo.id,
        bot_name: result.keyInfo.bot_name,
        scopes: result.keyInfo.scopes,
        raw_key: result.rawKey || '[REDACTED: Existing key is securely hashed in PostgreSQL]',
      },
    });
  } catch (error) {
    console.error('v1 POST /agent/provision-jarvis error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to provision Jarvis root key',
    });
  }
});

/**
 * GET /api/v1/agent/triage
 * Allows Jarvis to pull unread global mail across all mailboxes with full bodies & telemetry
 */
v1Router.get('/agent/triage', requireAgentScope('read_all'), async (req: Request, res: Response) => {
  try {
    const unreadOnly = req.query.unread_only !== 'false';
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const since = req.query.since as string | undefined;

    const conditions = [];

    if (unreadOnly) {
      conditions.push(eq(emails.is_read, false));
    }

    if (since) {
      const sinceDate = new Date(isNaN(Number(since)) ? since : Number(since));
      if (!isNaN(sinceDate.getTime())) {
        conditions.push(gte(emails.received_at, sinceDate));
      }
    }

    const query = db
      .select({
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
        received_at: emails.received_at,
      })
      .from(emails)
      .leftJoin(accounts, eq(emails.account_id, accounts.id))
      .orderBy(desc(emails.received_at))
      .limit(limit);

    const rows = conditions.length > 0 ? await query.where(and(...conditions)) : await query;

    return res.json({
      success: true,
      agent: (req as any).agent?.botName,
      total: rows.length,
      emails: rows.map((r) => ({
        ...r,
        received_at: r.received_at ? r.received_at.toISOString() : null,
      })),
    });
  } catch (error) {
    console.error('v1 GET /agent/triage error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to query triage telemetry',
    });
  }
});

/**
 * PATCH /api/v1/agent/triage
 * Allows Jarvis to patch email records with classified category, action requirements, etc.
 */
v1Router.patch('/agent/triage', requireAgentScope('read_all'), async (req: Request, res: Response) => {
  try {
    const { email_id, category, ai_summary, requires_alert, is_read } = req.body;

    if (!email_id) {
      return res.status(400).json({ success: false, error: 'email_id is required.' });
    }

    const updates: Record<string, any> = {};
    if (category) updates.category = category;
    if (ai_summary !== undefined) updates.ai_summary = ai_summary;
    if (requires_alert !== undefined) updates.requires_alert = Boolean(requires_alert);
    if (is_read !== undefined) updates.is_read = Boolean(is_read);

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid triage fields provided (category, ai_summary, requires_alert, is_read).',
      });
    }

    const updated = await db.update(emails).set(updates).where(eq(emails.id, email_id)).returning();

    if (updated.length === 0) {
      return res.status(404).json({ success: false, error: `Email "${email_id}" not found.` });
    }

    return res.json({
      success: true,
      message: `Email "${email_id}" triaged successfully by ${(req as any).agent?.botName}.`,
      data: updated[0],
    });
  } catch (error) {
    console.error('v1 PATCH /agent/triage error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update email record',
    });
  }
});

/**
 * POST /api/v1/agent/dispatch
 * Outbound dispatch for Jarvis to send emails via Stalwart SMTP relay
 */
v1Router.post('/agent/dispatch', requireAgentScope('send_as_any'), async (req: Request, res: Response) => {
  try {
    const { from, to, subject, htmlBody, textBody, replyTo, thread_id } = req.body;

    if (!to || !subject || !htmlBody) {
      return res.status(400).json({
        success: false,
        error: 'Required fields missing: to, subject, and htmlBody are required.',
      });
    }

    const defaultSender = process.env.JARVIS_DEFAULT_SENDER || 'jarvis@aethermail.com';
    const sender = (from || defaultSender).trim();
    const recipient = Array.isArray(to) ? to.join(', ') : to.trim();

    const dispatchResult = await dispatchViaStalwartSmtp({
      from: sender,
      to,
      subject,
      htmlBody,
      textBody,
      replyTo,
    });

    const messageId = dispatchResult.messageId || `msg_jrv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const threadId = thread_id || `th_${Date.now()}`;
    const snippet = textBody || htmlBody.replace(/<[^>]*>/g, '').slice(0, 140).trim();

    const [existingAcc] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.email_address, sender))
      .limit(1);

    const accountId = existingAcc ? existingAcc.id : `acc_agent_${Date.now()}`;
    if (!existingAcc) {
      await db
        .insert(accounts)
        .values({
          id: accountId,
          provider: 'stalwart',
          email_address: sender,
          sync_status: 'synced',
          created_at: new Date(),
        })
        .onConflictDoNothing();
    }

    const newRecord: NewEmail = {
      id: messageId,
      account_id: accountId,
      thread_id: threadId,
      subject,
      sender: `Jarvis <${sender}>`,
      body_snippet: snippet,
      full_body: htmlBody,
      category: 'work',
      ai_summary: `Autonomous response dispatched by Jarvis to ${recipient}`,
      requires_alert: false,
      is_read: true,
      received_at: new Date(),
    };

    await db.insert(emails).values(newRecord).onConflictDoNothing();

    return res.json({
      success: true,
      message: 'Email dispatched via Stalwart SMTP relay and logged to database.',
      agent: (req as any).agent?.botName,
      data: {
        message_id: messageId,
        from: sender,
        to: recipient,
        subject,
        transport: 'stalwart-smtp',
        dispatched_at: new Date().toISOString(),
        relay_status: dispatchResult.success ? 'delivered' : 'queued_or_fallback',
        error: dispatchResult.error,
      },
    });
  } catch (error) {
    console.error('v1 POST /agent/dispatch error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal dispatch failure',
    });
  }
});

/**
 * Direct Gmail IMAP Sync: Fetches real inbox messages using Google App Passwords
 */
v1Router.post('/sync/gmail', async (req: Request, res: Response) => {
  try {
    const { email_address, app_password, limit } = req.body;
    if (!email_address || !app_password) {
      return res.status(400).json({
        success: false,
        error: 'email_address and app_password are required.',
      });
    }

    const { syncGmailAccount } = await import('../lib/imap-sync.ts');
    const result = await syncGmailAccount(email_address, app_password, limit || 20);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error || 'Failed to authenticate or sync with Gmail IMAP server.',
      });
    }

    return res.json({
      success: true,
      message: `Successfully synchronized ${result.imported} messages from Gmail inbox.`,
      imported: result.imported,
      email_address,
    });
  } catch (err) {
    console.error('v1 POST /sync/gmail error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal IMAP sync error',
    });
  }
});
