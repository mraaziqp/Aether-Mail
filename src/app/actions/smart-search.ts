'use server';

/**
 * Next.js Server Action: Natural Language Smart Search
 * Path: /src/app/actions/smart-search.ts
 *
 * Uses Gemini 2.5 Flash to parse natural language queries into structured search parameters,
 * then dynamically queries PostgreSQL via Drizzle ORM.
 */

import { db } from '../../db/index.ts';
import { emails, accounts } from '../../db/schema.ts';
import { getGeminiClient } from '../../lib/gemini.ts';
import { eq, and, or, ilike, gte, desc } from 'drizzle-orm';
import { Type } from '@google/genai';
import type { EmailItem } from '../../types.ts';

export interface ParsedSearchIntent {
  category: 'urgent' | 'personal' | 'newsletter' | 'automated' | 'work' | 'financial' | null;
  requires_alert: boolean | null;
  keywords: string[];
  sender: string | null;
  days_ago: number | null;
  intent_explanation: string;
}

export interface SmartSearchResponse {
  success: boolean;
  emails: EmailItem[];
  parsedIntent?: ParsedSearchIntent;
  error?: string;
}

export async function smartSearchAction(
  query: string,
  accountId?: string
): Promise<SmartSearchResponse> {
  try {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      // Return recent emails if query is empty
      const results = await db
        .select({
          id: emails.id,
          account_id: emails.account_id,
          thread_id: emails.thread_id,
          subject: emails.subject,
          sender: emails.sender,
          body_snippet: emails.body_snippet,
          full_body: emails.full_body,
          category: emails.category as any,
          ai_summary: emails.ai_summary,
          requires_alert: emails.requires_alert,
          is_read: emails.is_read,
          received_at: emails.received_at,
          account_email: accounts.email_address,
        })
        .from(emails)
        .leftJoin(accounts, eq(emails.account_id, accounts.id))
        .orderBy(desc(emails.received_at))
        .limit(50);

      return {
        success: true,
        emails: results.map((r) => ({
          ...r,
          received_at: r.received_at ? r.received_at.toISOString() : new Date().toISOString(),
        })),
      };
    }

    // 1. Pass semantic query to Gemini to parse intent into structured parameters
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

    let parsedIntent: ParsedSearchIntent = {
      category: null,
      requires_alert: null,
      keywords: [trimmedQuery],
      sender: null,
      days_ago: null,
      intent_explanation: `Searching for "${trimmedQuery}"`,
    };

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
                enum: ['urgent', 'personal', 'newsletter', 'automated', 'work', 'financial', 'null'],
              },
              requires_alert: {
                type: Type.BOOLEAN,
                nullable: true,
              },
              keywords: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              sender: {
                type: Type.STRING,
                nullable: true,
              },
              days_ago: {
                type: Type.INTEGER,
                nullable: true,
              },
              intent_explanation: {
                type: Type.STRING,
              },
            },
            required: ['intent_explanation'],
          },
        },
      });

      const responseText = response.text;
      if (responseText) {
        const rawJson = JSON.parse(responseText);
        parsedIntent = {
          category: rawJson.category === 'null' || !rawJson.category ? null : rawJson.category,
          requires_alert: typeof rawJson.requires_alert === 'boolean' ? rawJson.requires_alert : null,
          keywords: Array.isArray(rawJson.keywords) && rawJson.keywords.length > 0 ? rawJson.keywords : [trimmedQuery],
          sender: rawJson.sender || null,
          days_ago: typeof rawJson.days_ago === 'number' ? rawJson.days_ago : null,
          intent_explanation: rawJson.intent_explanation || `Searching for ${trimmedQuery}`,
        };
      }
    } catch (parseErr) {
      console.warn('Gemini intent extraction fallback:', parseErr);
      // Fallback heuristics
      const lower = trimmedQuery.toLowerCase();
      if (lower.includes('urgent') || lower.includes('alert')) {
        parsedIntent.requires_alert = true;
      }
      if (lower.includes('financial') || lower.includes('invoice')) {
        parsedIntent.category = 'financial';
      }
    }

    // 2. Query PostgreSQL with Drizzle ORM dynamically
    const conditions = [];

    if (accountId && accountId !== 'all') {
      conditions.push(eq(emails.account_id, accountId));
    }

    if (parsedIntent.category) {
      conditions.push(eq(emails.category, parsedIntent.category));
    }

    if (parsedIntent.requires_alert !== null) {
      conditions.push(eq(emails.requires_alert, parsedIntent.requires_alert));
    }

    if (parsedIntent.sender) {
      conditions.push(ilike(emails.sender, `%${parsedIntent.sender}%`));
    }

    if (parsedIntent.days_ago && parsedIntent.days_ago > 0) {
      const cutoff = new Date(Date.now() - parsedIntent.days_ago * 24 * 60 * 60 * 1000);
      conditions.push(gte(emails.received_at, cutoff));
    }

    // Keyword filtering across subject, summary, and body
    if (parsedIntent.keywords.length > 0) {
      const keywordFilters = parsedIntent.keywords.map((kw) =>
        or(
          ilike(emails.subject, `%${kw}%`),
          ilike(emails.ai_summary, `%${kw}%`),
          ilike(emails.full_body, `%${kw}%`),
          ilike(emails.sender, `%${kw}%`)
        )
      );
      conditions.push(or(...keywordFilters));
    }

    const queryBuilder = db
      .select({
        id: emails.id,
        account_id: emails.account_id,
        thread_id: emails.thread_id,
        subject: emails.subject,
        sender: emails.sender,
        body_snippet: emails.body_snippet,
        full_body: emails.full_body,
        category: emails.category as any,
        ai_summary: emails.ai_summary,
        requires_alert: emails.requires_alert,
        is_read: emails.is_read,
        received_at: emails.received_at,
        account_email: accounts.email_address,
      })
      .from(emails)
      .leftJoin(accounts, eq(emails.account_id, accounts.id))
      .orderBy(desc(emails.received_at))
      .limit(50);

    const rows = conditions.length > 0
      ? await queryBuilder.where(and(...conditions))
      : await queryBuilder;

    let finalRows = rows;
    if (finalRows.length === 0) {
      // Secondary fallback 1: If category or requires_alert was found, search by those without strict keyword constraint
      const relaxedConditions = [];
      if (accountId && accountId !== 'all') {
        relaxedConditions.push(eq(emails.account_id, accountId));
      }
      if (parsedIntent.category) {
        relaxedConditions.push(eq(emails.category, parsedIntent.category));
      }
      if (parsedIntent.requires_alert !== null) {
        relaxedConditions.push(eq(emails.requires_alert, parsedIntent.requires_alert));
      }

      if (relaxedConditions.length > 0) {
        const relaxedRows = await db
          .select({
            id: emails.id,
            account_id: emails.account_id,
            thread_id: emails.thread_id,
            subject: emails.subject,
            sender: emails.sender,
            body_snippet: emails.body_snippet,
            full_body: emails.full_body,
            category: emails.category as any,
            ai_summary: emails.ai_summary,
            requires_alert: emails.requires_alert,
            is_read: emails.is_read,
            received_at: emails.received_at,
            account_email: accounts.email_address,
          })
          .from(emails)
          .leftJoin(accounts, eq(emails.account_id, accounts.id))
          .where(and(...relaxedConditions))
          .orderBy(desc(emails.received_at))
          .limit(30);

        if (relaxedRows.length > 0) {
          finalRows = relaxedRows;
        }
      }
    }

    // Secondary fallback 2: Tokenized word matching across subject, summary, and body
    if (finalRows.length === 0 && trimmedQuery) {
      const words = trimmedQuery
        .split(/\s+/)
        .filter((w) => w.length > 2 && !['the', 'and', 'for', 'from', 'with', 'about', 'find'].includes(w.toLowerCase()));

      const wordFilters = words.map((w) =>
        or(
          ilike(emails.subject, `%${w}%`),
          ilike(emails.ai_summary, `%${w}%`),
          ilike(emails.full_body, `%${w}%`),
          ilike(emails.sender, `%${w}%`)
        )
      );

      if (wordFilters.length > 0) {
        const tokenRows = await db
          .select({
            id: emails.id,
            account_id: emails.account_id,
            thread_id: emails.thread_id,
            subject: emails.subject,
            sender: emails.sender,
            body_snippet: emails.body_snippet,
            full_body: emails.full_body,
            category: emails.category as any,
            ai_summary: emails.ai_summary,
            requires_alert: emails.requires_alert,
            is_read: emails.is_read,
            received_at: emails.received_at,
            account_email: accounts.email_address,
          })
          .from(emails)
          .leftJoin(accounts, eq(emails.account_id, accounts.id))
          .where(or(...wordFilters))
          .orderBy(desc(emails.received_at))
          .limit(30);

        if (tokenRows.length > 0) {
          finalRows = tokenRows;
        }
      }
    }

    return {
      success: true,
      emails: finalRows.map((r) => ({
        ...r,
        received_at: r.received_at ? r.received_at.toISOString() : new Date().toISOString(),
      })),
      parsedIntent,
    };
  } catch (error) {
    console.error('smartSearchAction error:', error);
    return {
      success: false,
      emails: [],
      error: error instanceof Error ? error.message : 'Search failed',
    };
  }
}
