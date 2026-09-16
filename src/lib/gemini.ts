import { GoogleGenAI, Type } from '@google/genai';
import type { GeminiExtractionResult } from '../types.ts';

let aiClient: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    aiClient = new GoogleGenAI(apiKey ? { apiKey } : {});
  }
  return aiClient;
}

/**
 * Analyzes raw incoming email with Gemini 2.5 Flash
 * Extracts category enum, strict 1-sentence TL;DR summary, and requires_alert boolean.
 */
export async function processEmailWithGemini(params: {
  subject: string;
  sender: string;
  body: string;
}): Promise<GeminiExtractionResult> {
  const ai = getGeminiClient();

  const prompt = `Analyze this incoming email and extract structured metadata:
Sender: ${params.sender}
Subject: ${params.subject}

Body:
${params.body}

Guidelines:
1. "category" must be strictly one of: urgent, personal, newsletter, automated, work, financial.
2. "summary" must be a strict 1-sentence TL;DR highlighting the main outcome, request, or action item.
3. "requires_alert" must be true if this email requires immediate human attention (e.g. critical security issue, server outage, urgent financial action, tight turnaround deadline). Otherwise false.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            category: {
              type: Type.STRING,
              enum: ['urgent', 'personal', 'newsletter', 'automated', 'work', 'financial'],
            },
            summary: {
              type: Type.STRING,
              description: 'A strict 1-sentence TL;DR',
            },
            requires_alert: {
              type: Type.BOOLEAN,
              description: 'True if the email needs immediate human attention',
            },
          },
          required: ['category', 'summary', 'requires_alert'],
        },
      },
    });

    const text = response.text;
    if (!text) {
      throw new Error('No text returned from Gemini');
    }

    const parsed = JSON.parse(text) as GeminiExtractionResult;
    return parsed;
  } catch (error) {
    console.error('Gemini extraction error:', error);
    // Graceful fallback logic
    const content = `${params.subject} ${params.body}`.toLowerCase();
    let category: GeminiExtractionResult['category'] = 'work';
    let requires_alert = false;

    if (content.includes('urgent') || content.includes('emergency') || content.includes('critical') || content.includes('action required')) {
      category = 'urgent';
      requires_alert = true;
    } else if (content.includes('invoice') || content.includes('billing') || content.includes('receipt') || content.includes('payment') || content.includes('wire transfer')) {
      category = 'financial';
    } else if (content.includes('newsletter') || content.includes('digest') || content.includes('unsubscribe')) {
      category = 'newsletter';
    } else if (content.includes('noreply') || content.includes('no-reply') || content.includes('automated') || content.includes('system')) {
      category = 'automated';
    } else if (content.includes('dinner') || content.includes('family') || content.includes('weekend') || content.includes('coffee')) {
      category = 'personal';
    }

    return {
      category,
      summary: `${params.subject}: ${params.body.slice(0, 100).replace(/\s+/g, ' ').trim()}...`,
      requires_alert,
    };
  }
}

/**
 * Drafts an intelligent response via Gemini based on context, tone, and user instructions.
 */
export async function generateSmartReplyWithGemini(params: {
  subject: string;
  sender: string;
  body: string;
  aiSummary: string;
  tone?: string;
  instructions?: string;
}): Promise<string> {
  const ai = getGeminiClient();
  const tone = params.tone || 'professional';
  const instructions = params.instructions ? `Custom user instruction: ${params.instructions}` : '';

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
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    return response.text?.trim() || 'Hi,\n\nThank you for your message. I have reviewed the details and will follow up with you shortly.\n\nBest regards,\n[Your Name]';
  } catch (err) {
    console.error('Smart reply generation error:', err);
    return `Hi,\n\nThank you for reaching out regarding "${params.subject}". I have received your email and will get back to you with the required details as soon as possible.\n\nBest regards,\n[Your Name]`;
  }
}
