import { db } from '../../../../../db/index.ts';
import { emails, accounts, type EmailCategory } from '../../../../../db/schema.ts';
import { validateAgentRequest } from '../../../../../lib/agent-auth.ts';
import { eq, desc, and, gte } from 'drizzle-orm';

export interface PatchTriageRequest {
  email_id: string;
  category?: EmailCategory;
  ai_summary?: string;
  requires_alert?: boolean;
  is_read?: boolean;
}

/**
 * GET /api/v1/agent/triage
 * Allows Jarvis to pull unread global mail across all mailboxes with full bodies,
 * metadata, and triage telemetry.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = await validateAgentRequest(request, 'read_all');
  if (!auth.authorized) {
    return auth.response as Response;
  }

  try {
    const url = new URL(request.url);
    const unreadOnly = url.searchParams.get('unread_only') !== 'false'; // default true
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 200);
    const since = url.searchParams.get('since');

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

    return Response.json({
      success: true,
      agent: auth.agent?.botName,
      total: rows.length,
      emails: rows.map((r) => ({
        ...r,
        received_at: r.received_at ? r.received_at.toISOString() : null,
      })),
    });
  } catch (error) {
    console.error('Agent triage GET error:', error);
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to query global triage feed',
      },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/v1/agent/triage
 * Allows Jarvis to patch email records with updated categorization,
 * action requirements, executive summaries, and read status.
 */
export async function PATCH(request: Request): Promise<Response> {
  const auth = await validateAgentRequest(request, 'read_all');
  if (!auth.authorized) {
    return auth.response as Response;
  }

  try {
    const body: PatchTriageRequest = await request.json();

    if (!body.email_id) {
      return Response.json(
        { success: false, error: 'email_id is required in request body.' },
        { status: 400 }
      );
    }

    const updates: Record<string, any> = {};

    if (body.category) updates.category = body.category;
    if (body.ai_summary !== undefined) updates.ai_summary = body.ai_summary;
    if (body.requires_alert !== undefined) updates.requires_alert = Boolean(body.requires_alert);
    if (body.is_read !== undefined) updates.is_read = Boolean(body.is_read);

    if (Object.keys(updates).length === 0) {
      return Response.json(
        { success: false, error: 'No valid triage fields provided (category, ai_summary, requires_alert, is_read).' },
        { status: 400 }
      );
    }

    const updated = await db
      .update(emails)
      .set(updates)
      .where(eq(emails.id, body.email_id))
      .returning();

    if (updated.length === 0) {
      return Response.json(
        { success: false, error: `Email "${body.email_id}" not found.` },
        { status: 404 }
      );
    }

    return Response.json({
      success: true,
      message: `Email "${body.email_id}" triaged successfully by ${auth.agent?.botName}.`,
      data: updated[0],
    });
  } catch (error) {
    console.error('Agent triage PATCH error:', error);
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to apply triage updates',
      },
      { status: 500 }
    );
  }
}
