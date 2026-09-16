'use server';

/**
 * Next.js Server Action: Batch Email Management
 * Path: /src/app/actions/batch-emails.ts
 *
 * Executes bulk operations (mark read, mark unread, delete/archive)
 * on PostgreSQL records via Drizzle ORM.
 */

import { db } from '../../db/index.ts';
import { emails } from '../../db/schema.ts';
import { inArray } from 'drizzle-orm';

export interface BatchEmailsParams {
  emailIds: string[];
  action: 'mark_read' | 'mark_unread' | 'delete';
}

export interface BatchEmailsResponse {
  success: boolean;
  affectedCount: number;
  action: string;
  error?: string;
}

export async function batchUpdateEmailsAction(
  params: BatchEmailsParams
): Promise<BatchEmailsResponse> {
  try {
    const { emailIds, action } = params;

    if (!Array.isArray(emailIds) || emailIds.length === 0) {
      return {
        success: false,
        affectedCount: 0,
        action,
        error: 'No email IDs provided for batch operation.',
      };
    }

    if (action === 'mark_read') {
      const result = await db
        .update(emails)
        .set({ is_read: true })
        .where(inArray(emails.id, emailIds))
        .returning();

      return {
        success: true,
        affectedCount: result.length,
        action: 'mark_read',
      };
    }

    if (action === 'mark_unread') {
      const result = await db
        .update(emails)
        .set({ is_read: false })
        .where(inArray(emails.id, emailIds))
        .returning();

      return {
        success: true,
        affectedCount: result.length,
        action: 'mark_unread',
      };
    }

    if (action === 'delete') {
      const result = await db
        .delete(emails)
        .where(inArray(emails.id, emailIds))
        .returning();

      return {
        success: true,
        affectedCount: result.length,
        action: 'delete',
      };
    }

    return {
      success: false,
      affectedCount: 0,
      action,
      error: `Unknown batch action: "${action}"`,
    };
  } catch (error) {
    console.error('batchUpdateEmailsAction error:', error);
    return {
      success: false,
      affectedCount: 0,
      action: params.action,
      error: error instanceof Error ? error.message : 'Failed to execute batch operation',
    };
  }
}
