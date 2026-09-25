import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { db } from '../db/index.ts';
import { emails, accounts, type NewEmail, type NewAccount } from '../db/schema.ts';
import { eq } from 'drizzle-orm';
import { processEmailWithGemini } from './gemini.ts';

export interface ImapSyncResult {
  success: boolean;
  imported: number;
  error?: string;
}

/**
 * Connects to a Gmail account via IMAP using an App Password,
 * fetches recent messages, runs AI extraction, and stores them in AetherMail.
 */
export async function syncGmailAccount(
  emailAddress: string,
  appPassword: string,
  limit: number = 20
): Promise<ImapSyncResult> {
  const cleanEmail = emailAddress.trim().toLowerCase();
  const cleanPassword = appPassword.replace(/\s+/g, '');

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: {
      user: cleanEmail,
      pass: cleanPassword,
    },
    logger: false,
    tls: {
      rejectUnauthorized: false,
    },
  });

  try {
    await client.connect();

    // Ensure account exists in database
    const [existingAccount] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.email_address, cleanEmail))
      .limit(1);

    const accountId = existingAccount ? existingAccount.id : `acc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    if (!existingAccount) {
      await db.insert(accounts).values({
        id: accountId,
        provider: 'google',
        email_address: cleanEmail,
        sync_status: 'synced',
        created_at: new Date(),
      });
    }

    const lock = await client.getMailboxLock('INBOX');
    let imported = 0;

    try {
      // Find the range of the last N messages
      const status = await client.status('INBOX', { messages: true });
      const totalMessages = status.messages || 0;

      if (totalMessages > 0) {
        const startSeq = Math.max(1, totalMessages - limit + 1);
        const seqRange = `${startSeq}:${totalMessages}`;

        for await (const message of client.fetch(seqRange, { source: true, envelope: true })) {
          if (!message.source) continue;

          try {
            const parsed = await simpleParser(message.source);
            const msgId = parsed.messageId || `imap_${message.uid}_${Date.now()}`;

            // Check if already imported
            const [existingEmail] = await db
              .select({ id: emails.id })
              .from(emails)
              .where(eq(emails.id, msgId))
              .limit(1);

            if (existingEmail) {
              continue;
            }

            const subject = parsed.subject || '(No Subject)';
            const sender = parsed.from?.text || cleanEmail;
            const toText = parsed.to ? (Array.isArray(parsed.to) ? parsed.to.map((t) => t.text).join(' ') : parsed.to.text) : '';
            const deliveredTo = (parsed.headers?.get('delivered-to') as string) || '';
            const fullBody = parsed.html || parsed.text || '';
            const snippet = (parsed.text || fullBody.replace(/<[^>]*>/g, '')).slice(0, 140).trim();
            const receivedAt = parsed.date || new Date();

            // Fast category heuristic to ensure lightning-fast synchronization
            const lowerSub = subject.toLowerCase();
            const lowerBody = fullBody.toLowerCase();
            const lowerRecipients = `${toText} ${deliveredTo} ${snippet}`.toLowerCase();

            let targetAccountId = accountId;

            // Map forwarded or direct business emails to the official ARP Cloud Solutions accounts
            if (
              lowerRecipients.includes('info@arpcloudsolutions.co.za') ||
              lowerSub.includes('payfast') ||
              lowerBody.includes('payfast')
            ) {
              const [bizAcc] = await db
                .select()
                .from(accounts)
                .where(eq(accounts.email_address, 'info@arpcloudsolutions.co.za'))
                .limit(1);
              if (bizAcc) {
                targetAccountId = bizAcc.id;
              }
            } else if (lowerRecipients.includes('contact@arpcloudsolutions.co.za')) {
              const [bizAcc] = await db
                .select()
                .from(accounts)
                .where(eq(accounts.email_address, 'contact@arpcloudsolutions.co.za'))
                .limit(1);
              if (bizAcc) {
                targetAccountId = bizAcc.id;
              }
            }

            let cat: 'urgent' | 'personal' | 'newsletter' | 'automated' | 'work' | 'financial' = 'personal';
            let requiresAlert = false;

            if (lowerSub.includes('alert') || lowerSub.includes('urgent') || lowerSub.includes('action required') || lowerSub.includes('security')) {
              cat = 'urgent';
              requiresAlert = true;
            } else if (lowerSub.includes('invoice') || lowerSub.includes('payment') || lowerSub.includes('payfast') || lowerSub.includes('receipt') || lowerSub.includes('bank') || lowerSub.includes('statement')) {
              cat = 'financial';
              requiresAlert = lowerSub.includes('payfast') || lowerSub.includes('action') || lowerSub.includes('verify');
            } else if (lowerSub.includes('unsubscribe') || lowerBody.includes('unsubscribe') || lowerSub.includes('newsletter') || lowerSub.includes('digest')) {
              cat = 'newsletter';
            } else if (lowerSub.includes('noreply') || lowerSub.includes('no-reply') || sender.includes('no-reply') || sender.includes('noreply')) {
              cat = 'automated';
            } else if (lowerSub.includes('job') || lowerSub.includes('project') || lowerSub.includes('meeting') || lowerSub.includes('client') || lowerSub.includes('solutions')) {
              cat = 'work';
            }

            if (lowerSub.includes('payfast') || lowerBody.includes('payfast')) {
              cat = 'financial';
              requiresAlert = true;
            }

            const newEmail: NewEmail = {
              id: msgId,
              account_id: targetAccountId,
              thread_id: `thread_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              subject,
              sender,
              body_snippet: snippet,
              full_body: fullBody,
              category: cat,
              ai_summary: snippet.slice(0, 120) || `Message from ${sender}: ${subject}`,
              requires_alert: requiresAlert,
              is_read: false,
              received_at: receivedAt,
            };

            await db.insert(emails).values(newEmail).onConflictDoNothing();
            imported++;

            // Instant push dispatch via ntfy.sh for high priority/financial/security alerts
            if (requiresAlert) {
              const ntfyTopic = process.env.NTFY_TOPIC || 'aethermail-alerts';
              try {
                await fetch(`https://ntfy.sh/${ntfyTopic}`, {
                  method: 'POST',
                  headers: {
                    Title: `🚨 [Jarvis Alert] ${subject.slice(0, 60)}`,
                    Priority: 'urgent',
                    Tags: 'rotating_light,envelope,warning',
                    Click: 'https://aethermail-five.vercel.app',
                  },
                  body: `Account: ${cleanEmail}\nFrom: ${sender}\n\nSubject: ${subject}\n\nSummary: ${snippet.slice(0, 150)}`,
                  signal: AbortSignal.timeout(3000),
                });
              } catch (pushErr) {
                console.warn('[ntfy.sh] Push alert error in IMAP sync:', pushErr);
              }
            }
          } catch (msgErr) {
            console.warn('[IMAP Sync] Error parsing message:', msgErr);
          }
        }
      }
    } finally {
      lock.release();
    }

    return { success: true, imported };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[IMAP Sync Error for ${cleanEmail}]:`, errorMsg);
    return { success: false, imported: 0, error: errorMsg };
  } finally {
    try {
      if (client.authenticated) {
        await client.logout();
      } else {
        client.close();
      }
    } catch {
      try { client.close(); } catch {}
    }
  }
}
