import { db } from '../../../../../db/index.ts';
import { emails, accounts, type NewEmail } from '../../../../../db/schema.ts';
import { validateAgentRequest } from '../../../../../lib/agent-auth.ts';
import { dispatchViaStalwartSmtp } from '../../../../../lib/stalwart.ts';
import { eq } from 'drizzle-orm';

export interface AgentDispatchRequest {
  from?: string;
  to: string | string[];
  subject: string;
  htmlBody: string;
  textBody?: string;
  replyTo?: string;
  thread_id?: string;
}

/**
 * POST /api/v1/agent/dispatch
 * Outbound dispatch endpoint for autonomous agent Jarvis to send emails
 * directly via the Stalwart SMTP relay, masking itself as a native client.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await validateAgentRequest(request, 'send_as_any');
  if (!auth.authorized) {
    return auth.response as Response;
  }

  try {
    const body: AgentDispatchRequest = await request.json();

    if (!body.to || !body.subject || !body.htmlBody) {
      return Response.json(
        {
          success: false,
          error: 'Required fields missing: to, subject, and htmlBody are required.',
        },
        { status: 400 }
      );
    }

    const defaultSender = process.env.JARVIS_DEFAULT_SENDER || 'jarvis@aethermail.com';
    const sender = (body.from || defaultSender).trim();
    const recipient = Array.isArray(body.to) ? body.to.join(', ') : body.to.trim();

    // 1. Dispatch outbound email via Stalwart SMTP relay
    const dispatchResult = await dispatchViaStalwartSmtp({
      from: sender,
      to: body.to,
      subject: body.subject,
      htmlBody: body.htmlBody,
      textBody: body.textBody,
      replyTo: body.replyTo,
    });

    const messageId = dispatchResult.messageId || `msg_jrv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const threadId = body.thread_id || `th_${Date.now()}`;
    const snippet = body.textBody || body.htmlBody.replace(/<[^>]*>/g, '').slice(0, 140).trim();

    // 2. Ensure an account record exists for this sender identity in unified view
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

    // 3. Record outbound message into PostgreSQL via Drizzle
    const newRecord: NewEmail = {
      id: messageId,
      account_id: accountId,
      thread_id: threadId,
      subject: body.subject,
      sender: `Jarvis <${sender}>`,
      body_snippet: snippet,
      full_body: body.htmlBody,
      category: 'work',
      ai_summary: `Autonomous response dispatched by Jarvis to ${recipient}`,
      requires_alert: false,
      is_read: true,
      received_at: new Date(),
    };

    await db.insert(emails).values(newRecord).onConflictDoNothing();

    return Response.json(
      {
        success: true,
        message: 'Email dispatched via Stalwart SMTP relay and logged to Neon database.',
        agent: auth.agent?.botName,
        data: {
          message_id: messageId,
          from: sender,
          to: recipient,
          subject: body.subject,
          transport: 'stalwart-smtp',
          dispatched_at: new Date().toISOString(),
          relay_status: dispatchResult.success ? 'delivered' : 'queued_or_fallback',
          error: dispatchResult.error,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Agent dispatch error:', error);
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal dispatch failure',
      },
      { status: 500 }
    );
  }
}
