/**
 * Next.js App Router Webhook Ingestion Route
 * Path: /src/app/api/webhooks/email/route.ts (or /api/webhooks/email)
 *
 * Receives external sync engine email payload, runs Gemini structured extraction,
 * and persists the email with AI metadata into the Cloud SQL PostgreSQL database via Drizzle.
 */

import { db } from '../../../../db/index.ts';
import { emails, accounts, type NewEmail } from '../../../../db/schema.ts';
import { processEmailWithGemini } from '../../../../lib/gemini.ts';
import { eq } from 'drizzle-orm';

export interface IncomingWebhookPayload {
  id?: string;
  account_id: string;
  thread_id?: string;
  subject: string;
  sender: string;
  body_snippet?: string;
  full_body: string;
  received_at?: string;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const rawPayload: IncomingWebhookPayload = await request.json();

    if (!rawPayload.account_id || !rawPayload.subject || !rawPayload.sender || !rawPayload.full_body) {
      return Response.json(
        { error: 'Missing required email fields: account_id, subject, sender, and full_body are required.' },
        { status: 400 }
      );
    }

    // 1. Ensure target account exists or auto-register it
    const existingAccounts = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, rawPayload.account_id))
      .limit(1);

    if (existingAccounts.length === 0) {
      // Auto-provision account if sync engine references new account ID
      await db.insert(accounts).values({
        id: rawPayload.account_id,
        provider: 'google',
        email_address: rawPayload.sender.includes('<')
          ? rawPayload.sender.split('<')[1]?.replace('>', '') || `${rawPayload.account_id}@unified.mail`
          : `${rawPayload.account_id}@unified.mail`,
        sync_status: 'synced',
      });
    }

    // 2. Run Gemini 2.5 Flash structured intelligence extraction
    const aiExtraction = await processEmailWithGemini({
      subject: rawPayload.subject,
      sender: rawPayload.sender,
      body: rawPayload.full_body,
    });

    const emailId = rawPayload.id || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const threadId = rawPayload.thread_id || `thread_${Date.now()}`;
    const snippet = rawPayload.body_snippet || rawPayload.full_body.slice(0, 140).replace(/\s+/g, ' ').trim();

    // 3. Persist parsed email with Gemini metadata into PostgreSQL via Drizzle
    const newEmailRecord: NewEmail = {
      id: emailId,
      account_id: rawPayload.account_id,
      thread_id: threadId,
      subject: rawPayload.subject,
      sender: rawPayload.sender,
      body_snippet: snippet,
      full_body: rawPayload.full_body,
      category: aiExtraction.category,
      ai_summary: aiExtraction.summary,
      requires_alert: aiExtraction.requires_alert,
      is_read: false,
      received_at: rawPayload.received_at ? new Date(rawPayload.received_at) : new Date(),
    };

    const insertedRows = await db
      .insert(emails)
      .values(newEmailRecord)
      .returning();

    // 4. Instant Critical Alert: If Gemini flags requires_alert: true, fire push notification to ntfy.sh
    let ntfyDispatched = false;
    if (aiExtraction.requires_alert) {
      const ntfyTopic = process.env.NTFY_TOPIC || 'aethermail-alerts';
      try {
        const pushBody = `From: ${rawPayload.sender}\n\nSubject: ${rawPayload.subject}\n\nAI Summary: ${aiExtraction.summary}\n\nAction Required: Immediate human attention requested.`;
        
        await fetch('https://ntfy.sh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topic: ntfyTopic,
            title: `🚨 [AetherMail Alert] ${rawPayload.subject.slice(0, 60)}`,
            message: pushBody,
            priority: 4,
            tags: ['warning', 'rotating_light', 'email'],
            click: process.env.APP_URL || 'https://mail.arpcloudsolutions.co.za',
          }),
          signal: AbortSignal.timeout(3000), // 3s non-blocking timeout
        });
        ntfyDispatched = true;
      } catch (pushErr) {
        console.warn('ntfy.sh push alert notification skipped or failed:', pushErr);
      }
    }

    return Response.json(
      {
        success: true,
        message: 'Email ingested and analyzed with Gemini successfully',
        data: insertedRows[0],
        alertDispatched: ntfyDispatched,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Webhook ingestion error:', error);
    return Response.json(
      {
        error: 'Failed to process email webhook',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
