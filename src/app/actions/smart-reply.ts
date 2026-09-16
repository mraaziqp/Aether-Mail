'use server';

/**
 * Next.js Server Action: Generate Smart Reply
 * Path: /src/app/actions/smart-reply.ts
 *
 * Invoked by the frontend detail view to draft an executive AI reply
 * using Gemini 2.5 Flash grounded in the original email content.
 */

import { db } from '../../db/index.ts';
import { emails } from '../../db/schema.ts';
import { generateSmartReplyWithGemini } from '../../lib/gemini.ts';
import { eq } from 'drizzle-orm';

export interface SmartReplyActionParams {
  emailId: string;
  tone?: 'professional' | 'concise' | 'friendly' | 'firm';
  instructions?: string;
}

export async function generateSmartReplyAction(params: SmartReplyActionParams): Promise<{
  success: boolean;
  draftReply?: string;
  error?: string;
}> {
  try {
    const { emailId, tone = 'professional', instructions } = params;

    const [emailRecord] = await db
      .select()
      .from(emails)
      .where(eq(emails.id, emailId))
      .limit(1);

    if (!emailRecord) {
      return { success: false, error: `Email record with ID "${emailId}" not found.` };
    }

    const draftReply = await generateSmartReplyWithGemini({
      subject: emailRecord.subject,
      sender: emailRecord.sender,
      body: emailRecord.full_body,
      aiSummary: emailRecord.ai_summary,
      tone,
      instructions,
    });

    return {
      success: true,
      draftReply,
    };
  } catch (error) {
    console.error('Server action generateSmartReplyAction failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error generating reply',
    };
  }
}
