'use server';

/**
 * Next.js Server Action / Core Service: Outbound Email Sending Engine
 * Path: /src/app/actions/send-email.ts
 *
 * Dispatches outbound email messages via Gmail SMTP, Stalwart/Resend SMTP relay,
 * or configured external REST transport, and logs the dispatch to the unified database.
 */

import nodemailer from 'nodemailer';
import { db } from '../../db/index.ts';
import { accounts, emails, type NewEmail } from '../../db/schema.ts';
import { eq } from 'drizzle-orm';
import { dispatchViaStalwartSmtp } from '../../lib/stalwart.ts';

export interface SendEmailParams {
  accountId: string;
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  htmlBody: string;
}

export interface SendEmailResponse {
  success: boolean;
  messageId?: string;
  dispatchedAt?: string;
  provider?: string;
  error?: string;
}

// Known credentials for authenticated sending profiles
const GMAIL_ACCOUNTS: Record<string, string> = {
  'mraaziqp@gmail.com': process.env.GMAIL_APP_PASSWORD || 'yehajpcshymlzwcq',
  'backupe9@gmail.com': process.env.BACKUPE9_APP_PASSWORD || 'scpjnpbgzbilrttj',
};

const cleanEmailList = (raw?: string | string[]): string[] => {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((r) => r.trim()).filter((r) => r.includes('@'));
  }
  return raw
    .split(/[,;\s]+/)
    .map((r) => r.trim())
    .filter((r) => r.includes('@'));
};

export async function sendEmailAction(params: SendEmailParams): Promise<SendEmailResponse> {
  try {
    const { accountId, to, cc, bcc, subject, htmlBody } = params;

    const toList = cleanEmailList(to);
    const ccList = cleanEmailList(cc);
    const bccList = cleanEmailList(bcc);

    if (!accountId || toList.length === 0 || !subject || !htmlBody) {
      return {
        success: false,
        error: 'Sender account, at least one recipient (to), subject, and message content are required.',
      };
    }

    // 1. Resolve Account details
    let senderAddress = accountId;
    let resolvedAccountId = accountId;
    let dbAppPassword = '';

    try {
      const [matchedAcc] = await db
        .select()
        .from(accounts)
        .where(eq(accounts.id, accountId))
        .limit(1);

      if (matchedAcc) {
        senderAddress = matchedAcc.email_address;
        resolvedAccountId = matchedAcc.id;
        if (matchedAcc.oauth_tokens && typeof matchedAcc.oauth_tokens === 'object' && 'app_password' in matchedAcc.oauth_tokens) {
          dbAppPassword = String((matchedAcc.oauth_tokens as any).app_password);
        }
      } else {
        const [matchedByEmail] = await db
          .select()
          .from(accounts)
          .where(eq(accounts.email_address, accountId))
          .limit(1);

        if (matchedByEmail) {
          senderAddress = matchedByEmail.email_address;
          resolvedAccountId = matchedByEmail.id;
          if (matchedByEmail.oauth_tokens && typeof matchedByEmail.oauth_tokens === 'object' && 'app_password' in matchedByEmail.oauth_tokens) {
            dbAppPassword = String((matchedByEmail.oauth_tokens as any).app_password);
          }
        }
      }
    } catch (err) {
      console.warn('[sendEmailAction] DB account resolution non-blocking error:', err);
    }

    let messageId: string = `msg_out_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    let providerUsed = 'Local Transport';
    let dispatchSuccess = false;
    let dispatchError: string | null = null;

    const normalizedSender = senderAddress.toLowerCase().trim();

    // 2. Dispatch Provider Routing
    // Case A: Sender is an authenticated Google/Gmail Account
    if (normalizedSender.includes('@gmail.com')) {
      const appPass = dbAppPassword || GMAIL_ACCOUNTS[normalizedSender] || process.env.GMAIL_APP_PASSWORD || 'yehajpcshymlzwcq';

      const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
          user: normalizedSender,
          pass: appPass,
        },
      });

      try {
        const info = await transporter.sendMail({
          from: `"${normalizedSender.split('@')[0]}" <${normalizedSender}>`,
          to: toList,
          cc: ccList.length > 0 ? ccList : undefined,
          bcc: bccList.length > 0 ? bccList : undefined,
          subject: subject.trim(),
          html: htmlBody,
          text: htmlBody.replace(/<[^>]*>/g, '').trim(),
          headers: {
            'X-Mailer': 'AetherMail-Unified-Engine/2.5',
          },
        });

        messageId = info.messageId || messageId;
        providerUsed = `Google SMTP (${normalizedSender})`;
        dispatchSuccess = true;
      } catch (gmailErr) {
        console.error('[sendEmailAction] Gmail SMTP delivery error:', gmailErr);
        dispatchError = gmailErr instanceof Error ? gmailErr.message : String(gmailErr);
      }
    } 
    // Case B: Explicit Enterprise SMTP Relay (Resend / Stalwart / Custom)
    else {
      const relayResult = await dispatchViaStalwartSmtp({
        from: senderAddress,
        to: toList,
        cc: ccList.length > 0 ? ccList : undefined,
        bcc: bccList.length > 0 ? bccList : undefined,
        subject: subject.trim(),
        htmlBody,
        replyTo: senderAddress,
      });

      if (relayResult.success) {
        messageId = relayResult.messageId || messageId;
        providerUsed = `Enterprise SMTP (${senderAddress})`;
        dispatchSuccess = true;
      } else {
        console.warn('[sendEmailAction] Enterprise SMTP relay failed, falling back to Google authenticated relay:', relayResult.error);
        
        // Case C: Fallback to verified master Google SMTP relay with Reply-To
        const relayUser = 'mraaziqp@gmail.com';
        const relayPass = GMAIL_ACCOUNTS[relayUser] || process.env.GMAIL_APP_PASSWORD || 'yehajpcshymlzwcq';

        const transporter = nodemailer.createTransport({
          host: 'smtp.gmail.com',
          port: 465,
          secure: true,
          auth: {
            user: relayUser,
            pass: relayPass,
          },
        });

        try {
          const isArpCloud = senderAddress.includes('arpcloudsolutions.co.za');
          const displayName = isArpCloud ? `ARP Cloud Solutions (${senderAddress})` : senderAddress;

          const info = await transporter.sendMail({
            from: `"${displayName}" <${relayUser}>`,
            replyTo: senderAddress,
            to: toList,
            cc: ccList.length > 0 ? ccList : undefined,
            bcc: bccList.length > 0 ? bccList : undefined,
            subject: subject.trim(),
            html: htmlBody,
            text: htmlBody.replace(/<[^>]*>/g, '').trim(),
            headers: {
              'X-Mailer': 'AetherMail-Unified-Engine/2.5',
              'X-Business-Sender': senderAddress,
            },
          });

          messageId = info.messageId || messageId;
          providerUsed = `Authenticated SMTP Relay (${senderAddress} via ${relayUser})`;
          dispatchSuccess = true;
        } catch (relayErr) {
          console.error('[sendEmailAction] Fallback relay delivery error:', relayErr);
          dispatchError = relayErr instanceof Error ? relayErr.message : String(relayErr);
        }
      }
    }

    if (!dispatchSuccess && dispatchError) {
      return {
        success: false,
        error: dispatchError,
      };
    }

    // 3. Log outbound email to Database so it immediately appears in the interface
    try {
      const snippet = htmlBody.replace(/<[^>]*>/g, '').slice(0, 140).trim();
      const allToText = toList.join(', ');
      const allCcText = ccList.length > 0 ? ` (Cc: ${ccList.join(', ')})` : '';

      const newRecord: NewEmail = {
        id: messageId,
        account_id: resolvedAccountId,
        thread_id: `thread_${Date.now()}`,
        subject,
        sender: senderAddress,
        body_snippet: `To: ${allToText}${allCcText} — ${snippet}`,
        full_body: `<div style="padding-bottom: 8px; margin-bottom: 12px; border-bottom: 1px solid #333; font-size: 12px; color: #888;">
          <strong>To:</strong> ${allToText}<br/>
          ${ccList.length > 0 ? `<strong>Cc:</strong> ${ccList.join(', ')}<br/>` : ''}
          ${bccList.length > 0 ? `<strong>Bcc:</strong> ${bccList.join(', ')}<br/>` : ''}
          <strong>From:</strong> ${senderAddress}<br/>
          <strong>Dispatched Via:</strong> ${providerUsed}
        </div>
        ${htmlBody}`,
        category: 'work',
        ai_summary: `Outbound dispatch to ${allToText}: ${subject}`,
        requires_alert: false,
        is_read: true,
        received_at: new Date(),
      };

      await db.insert(emails).values(newRecord).onConflictDoNothing();
    } catch (dbErr) {
      console.warn('[sendEmailAction] Failed to log outbound email to DB:', dbErr);
    }

    return {
      success: true,
      messageId,
      dispatchedAt: new Date().toISOString(),
      provider: providerUsed,
    };
  } catch (err) {
    console.error('sendEmailAction error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to dispatch email',
    };
  }
}
