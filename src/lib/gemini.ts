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
/**
 * Classifies via the local OpenAI-compatible server (Ollama/LM Studio).
 *
 * Returns null rather than throwing when the server is unreachable or the reply
 * is unusable, so the caller falls back to the keyword heuristic instead of
 * failing ingestion outright — a badly categorised email is much better than an
 * email that never arrives.
 */
const VALID_CATEGORIES = new Set([
  'urgent', 'personal', 'newsletter', 'automated', 'work', 'financial',
]);

async function classifyWithLocalModel(prompt: string): Promise<GeminiExtractionResult | null> {
  const baseUrl = (process.env.LOCAL_LLM_URL || 'http://localhost:11434/v1').replace(/\/$/, '');
  const model = process.env.LOCAL_LLM_MODEL || 'llama3.1:8b';

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content:
              'You classify email. Reply with ONLY a JSON object, no prose and no code fences: ' +
              '{"category":"urgent|personal|newsletter|automated|work|financial",' +
              '"summary":"one sentence","requires_alert":true|false}',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 200,
      }),
      // Local inference is slow and this runs during ingestion, so bound it.
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) return null;

    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = json.choices?.[0]?.message?.content ?? '';

    // Small models wrap JSON in prose or fences despite being told not to.
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;

    const parsed = JSON.parse(match[0]) as Partial<GeminiExtractionResult>;
    if (typeof parsed.category !== 'string' || !VALID_CATEGORIES.has(parsed.category)) return null;

    return {
      category: parsed.category as GeminiExtractionResult['category'],
      summary:
        typeof parsed.summary === 'string' && parsed.summary.trim()
          ? parsed.summary.trim()
          : 'No summary produced.',
      requires_alert: parsed.requires_alert === true,
    };
  } catch {
    return null;
  }
}

export async function processEmailWithGemini(params: {
  subject: string;
  sender: string;
  body: string;
}): Promise<GeminiExtractionResult> {
  // This machine runs no cloud AI keys, so classification goes to the local
  // model rather than silently degrading to keyword matching on every message.
  // Gemini is still used when a key is present.

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
    // Neither classifier available — fall through to the keyword heuristic.
    throw new Error('No classifier available (no GEMINI_API_KEY, local model unreachable)');
  }

  const ai = getGeminiClient();

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
