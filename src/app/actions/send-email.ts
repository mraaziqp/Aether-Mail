'use server';

/**
 * Next.js Server Action: Outbound Email Sending Engine
 * Path: /src/app/actions/send-email.ts
 *
 * Dispatches outbound email messages via the external sync engine's REST API.
 */

import { dispatchViaStalwartSmtp } from '../../lib/stalwart.ts';

export interface SendEmailParams {
  accountId: string;
  to: string;
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

export async function sendEmailAction(params: SendEmailParams): Promise<SendEmailResponse> {
  try {
    const { accountId, to, subject, htmlBody } = params;

    if (!accountId || !to || !subject || !htmlBody) {
      return {
        success: false,
        error: 'All fields (accountId, to, subject, htmlBody) are required to dispatch an email.',
      };
    }

    // No default: api.emailsync.internal does not exist, and defaulting to it
    // made an unconfigured install look configured.
    const syncApiUrl = process.env.EMAIL_SYNC_API_URL ?? '';

    const payload = {
      account_id: accountId,
      recipient: to,
      subject,
      html_content: htmlBody,
      text_content: htmlBody.replace(/<[^>]*>/g, ''),
      client_timestamp: new Date().toISOString(),
    };

    // Preferred path: a real SMTP server. dispatchViaStalwartSmtp was written but
    // nothing imported it, so outbound mail had no transport at all even though
    // the code existed.
    if (process.env.STALWART_SMTP_HOST) {
      const sent = await dispatchViaStalwartSmtp({
        from: process.env.AETHERMAIL_SENDER || `jarvis@${process.env.AETHERMAIL_DOMAIN || 'localhost'}`,
        to,
        subject,
        htmlBody,
      });

      if (!sent.success) {
        return {
          success: false,
          error: `SMTP refused the message: ${sent.error ?? 'unknown error'}. Nothing was sent.`,
        };
      }

      return {
        success: true,
        messageId: sent.messageId,
        dispatchedAt: new Date().toISOString(),
        provider: 'Stalwart SMTP',
      };
    }

    // A mail client must never claim it sent something it did not send.
    //
    // This previously caught the network error, invented a message id, and
    // returned success:true with provider "(Simulated)" — so an unreachable
    // sync engine looked identical to a delivered message. Losing mail silently
    // is worse than refusing to send it.
    if (!process.env.EMAIL_SYNC_API_URL) {
      return {
        success: false,
        error:
          'No outbound mail transport is configured. Set STALWART_SMTP_HOST to send via ' +
          'the mail server, or EMAIL_SYNC_API_URL for a REST bridge. Nothing was sent.',
      };
    }

    let response: Response;
    try {
      response = await fetch(syncApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.EMAIL_SYNC_API_KEY ?? ''}`,
          'X-Client-Agent': 'AetherMail-Dispatcher/1.0',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (networkErr) {
      return {
        success: false,
        error: `Mail transport unreachable at ${syncApiUrl}: ${
          networkErr instanceof Error ? networkErr.message : String(networkErr)
        }. Nothing was sent.`,
      };
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return {
        success: false,
        error: `Mail transport rejected the message (HTTP ${response.status}). ${detail.slice(0, 200)}`,
      };
    }

    const responseData = (await response.json().catch(() => null)) as
      | { message_id?: string; timestamp?: string }
      | null;

    return {
      success: true,
      messageId: responseData?.message_id ?? `outbound_${Date.now()}`,
      dispatchedAt: responseData?.timestamp ?? new Date().toISOString(),
      provider: 'Mail transport',
    };
  } catch (err) {
    console.error('sendEmailAction error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to dispatch email',
    };
  }
}
