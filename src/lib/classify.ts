import type { EmailCategory } from '../db/schema.ts';

export interface Classification {
  category: EmailCategory;
  requires_alert: boolean;
}

const has = (hay: string, needles: string[]) => needles.some((n) => hay.includes(n));

/**
 * Instant keyword classifier, used at ingest so a message is visible the moment
 * it is synced. When an AI model is configured the sync refines the result
 * afterwards; this is never allowed to block delivery into the inbox.
 */
export function heuristicClassify(input: {
  subject: string;
  sender: string;
  text: string;
  folderKind?: 'inbox' | 'spam' | 'sent';
}): Classification {
  if (input.folderKind === 'spam') return { category: 'spam', requires_alert: false };

  const subject = input.subject.toLowerCase();
  const sender = input.sender.toLowerCase();
  const body = input.text.slice(0, 4000).toLowerCase();

  if (has(subject, ['payfast'])) return { category: 'financial', requires_alert: true };

  if (
    has(subject, ['urgent', 'action required', 'immediate', 'outage', 'incident', 'critical', 'security alert', 'suspicious', 'password reset', 'verify your', 'expires today', 'final notice'])
  ) {
    return { category: 'urgent', requires_alert: true };
  }

  if (has(subject, ['invoice', 'payment', 'receipt', 'statement', 'bank', 'quote', 'quotation', 'purchase order', 'remittance', 'eft', 'refund', 'billing'])) {
    return {
      category: 'financial',
      requires_alert: has(subject, ['overdue', 'failed', 'declined', 'action', 'verify']),
    };
  }

  const automatedSender = has(sender, ['no-reply', 'noreply', 'donotreply', 'do-not-reply', 'notifications@', 'mailer-daemon', 'postmaster@', 'alerts@']);
  if (sender.includes('mailer-daemon') || subject.includes('undeliverable') || subject.includes('delivery status notification')) {
    return { category: 'automated', requires_alert: true };
  }

  if (has(body, ['unsubscribe', 'view this email in your browser', 'manage your preferences']) || has(subject, ['newsletter', 'digest', 'weekly', 'webinar'])) {
    return { category: automatedSender ? 'automated' : 'newsletter', requires_alert: false };
  }

  if (automatedSender) return { category: 'automated', requires_alert: false };

  if (has(subject, ['meeting', 'project', 'proposal', 'contract', 'client', 'deadline', 'enquiry', 'inquiry', 'request', 'quote', 'website', 'hosting', 'domain', 'support'])) {
    return { category: 'work', requires_alert: false };
  }

  return { category: 'personal', requires_alert: false };
}
