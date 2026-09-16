import { Router, type Request, type Response } from 'express';
import { db } from '../db/index.ts';
import { emails, accounts, api_keys, type NewApiKey } from '../db/schema.ts';
import { eq, and, desc, gte, sql } from 'drizzle-orm';
import { requireApiKey, generateNewApiKey } from '../lib/api-auth.ts';
import { sendEmailAction } from '../app/actions/send-email.ts';

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
