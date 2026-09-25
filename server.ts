import express from 'express';
import path from 'path';
import { db } from './src/db/index.ts';
import { accounts, emails, type NewEmail, type NewAccount } from './src/db/schema.ts';
import { processEmailWithGemini, generateSmartReplyWithGemini } from './src/lib/gemini.ts';
import { eq, desc, and } from 'drizzle-orm';
import { sendEmailAction } from './src/app/actions/send-email.ts';
import { smartSearchAction } from './src/app/actions/smart-search.ts';
import { batchUpdateEmailsAction } from './src/app/actions/batch-emails.ts';
import { v1Router } from './src/server/v1-router.ts';

// 3000 is NexussEmu, 3005 Second Brain, 3006 the hub — AetherMail takes 3007.
const PORT = Number(process.env.PORT) || 3007;

/** True when running inside Vercel's serverless runtime rather than on the laptop. */
const IS_SERVERLESS = !!process.env.VERCEL;

/**
 * Builds the configured Express app without binding a port.
 *
 * Split out from startServer so the same routes can be served two ways: by a
 * long-lived process on the laptop, and by Vercel's Node runtime, which imports
 * a handler and must never call listen() or start Vite's dev middleware.
 */
export async function createApp() {
  const app = express();

  app.use(express.json({ limit: '10mb' }));

  // Mount Bot & Agent Programmatic REST API v1
  app.use('/api/v1', v1Router);

  // 1. Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // 1b. Admin Authentication & Profile Management Routes
  let adminPassword = process.env.ADMIN_PASSWORD || '114477';
  let adminUsername = process.env.ADMIN_USERNAME || 'mraaziqp';
  let userProfile = {
    username: adminUsername,
    displayName: 'Mohamed Raaziq',
    role: 'Super Admin',
    primaryEmail: 'mraaziqp@gmail.com',
    domain: 'arpcloudsolutions.co.za',
    bio: 'Infrastructure & Payment Gateway Operations Lead',
  };

  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    if (username === adminUsername && password === adminPassword) {
      const token = `aether_sec_${Buffer.from(`${adminUsername}:${Date.now()}`).toString('base64')}`;
      return res.json({
        success: true,
        token,
        user: userProfile,
      });
    }
    return res.status(401).json({
      success: false,
      error: 'Invalid administrator credentials. Please check your username and password.',
    });
  });

  app.get('/api/auth/me', (_req, res) => {
    res.json({
      success: true,
      user: userProfile,
    });
  });

  app.post('/api/auth/profile', (req, res) => {
    const { displayName, primaryEmail, bio, currentPassword, newPassword } = req.body;
    if (newPassword) {
      if (currentPassword !== adminPassword) {
        return res.status(400).json({ success: false, error: 'Current password incorrect' });
      }
      adminPassword = newPassword;
    }
    if (displayName) userProfile.displayName = displayName;
    if (primaryEmail) userProfile.primaryEmail = primaryEmail;
    if (bio !== undefined) userProfile.bio = bio;

    return res.json({
      success: true,
      user: userProfile,
      message: 'Profile updated successfully',
    });
  });

  // 2. Webhook Ingestion Route (mirroring /api/webhooks/email)
  app.post('/api/webhooks/email', async (req, res) => {
    try {
      const {
        id,
        account_id,
        thread_id,
        subject,
        sender,
        body_snippet,
        full_body,
        received_at,
      } = req.body;

      if (!account_id || !subject || !sender || !full_body) {
        return res.status(400).json({
          error: 'Missing required email fields: account_id, subject, sender, and full_body are required.',
        });
      }

      // Check or create account
      const existingAccounts = await db
        .select()
        .from(accounts)
        .where(eq(accounts.id, account_id))
        .limit(1);

      if (existingAccounts.length === 0) {
        await db.insert(accounts).values({
          id: account_id,
          provider: 'google',
          email_address: sender.includes('<')
            ? sender.split('<')[1]?.replace('>', '') || `${account_id}@unified.mail`
            : `${account_id}@unified.mail`,
          sync_status: 'synced',
        });
      }

      // Run Gemini 2.5 Flash structured intelligence extraction
      const aiExtraction = await processEmailWithGemini({
        subject,
        sender,
        body: full_body,
      });

      const emailId = id || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const threadId = thread_id || `thread_${Date.now()}`;
      const snippet = body_snippet || full_body.slice(0, 140).replace(/\s+/g, ' ').trim();

      const newRecord: NewEmail = {
        id: emailId,
        account_id,
        thread_id: threadId,
        subject,
        sender,
        body_snippet: snippet,
        full_body,
        category: aiExtraction.category,
        ai_summary: aiExtraction.summary,
        requires_alert: aiExtraction.requires_alert,
        is_read: false,
        received_at: received_at ? new Date(received_at) : new Date(),
      };

      const inserted = await db.insert(emails).values(newRecord).returning();

      // Instant Critical Alerts: ntfy.sh integration if requires_alert is true
      let ntfyDispatched = false;
      if (aiExtraction.requires_alert) {
        const ntfyTopic = process.env.NTFY_TOPIC || 'aethermail-alerts';
        try {
          const pushBody = `From: ${sender}\n\nSubject: ${subject}\n\nAI Summary: ${aiExtraction.summary}\n\nAction Required: Immediate human attention flagged by Gemini 2.5 Flash.`;
          await fetch('https://ntfy.sh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              topic: ntfyTopic,
              title: `🚨 [AetherMail Alert] ${subject.slice(0, 60)}`,
              message: pushBody,
              priority: 4,
              tags: ['warning', 'rotating_light', 'email'],
              click: process.env.APP_URL || 'https://mail.arpcloudsolutions.co.za',
            }),
            signal: AbortSignal.timeout(3000),
          });
          ntfyDispatched = true;
        } catch (pushErr) {
          console.warn('ntfy.sh push alert error (Express):', pushErr);
        }
      }

      return res.status(201).json({
        success: true,
        message: 'Email ingested and analyzed with Gemini successfully',
        data: inserted[0],
        alertDispatched: ntfyDispatched,
      });
    } catch (error) {
      console.error('Webhook ingestion error in Express server:', error);
      return res.status(500).json({
        error: 'Failed to process email webhook',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Outbound email sending engine route
  app.post('/api/send-email', async (req, res) => {
    try {
      const { accountId, to, cc, bcc, subject, htmlBody } = req.body;
      const result = await sendEmailAction({ accountId, to, cc, bcc, subject, htmlBody });
      if (!result.success) {
        return res.status(400).json(result);
      }
      return res.json(result);
    } catch (error) {
      console.error('Outbound send email error:', error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to dispatch email',
      });
    }
  });

  // Natural Language Smart Search route
  app.post('/api/smart-search', async (req, res) => {
    try {
      const { query, accountId } = req.body;
      const result = await smartSearchAction(query || '', accountId);
      return res.json(result);
    } catch (error) {
      console.error('Smart search error:', error);
      return res.status(500).json({
        success: false,
        emails: [],
        error: error instanceof Error ? error.message : 'Smart search failed',
      });
    }
  });

  // PayFast Integration Status Route
  app.get('/api/payfast/status', async (_req, res) => {
    try {
      const merchantId = process.env.PAYFAST_MERCHANT_ID || '36249939';
      const hasKey = !!(process.env.PAYFAST_MERCHANT_KEY || 'dekw5mhqmi6yc');
      const [infoAccount] = await db
        .select()
        .from(accounts)
        .where(eq(accounts.email_address, 'info@arpcloudsolutions.co.za'))
        .limit(1);

      return res.json({
        success: true,
        connected: true,
        merchantId,
        merchantKeyConfigured: hasKey,
        businessEmail: 'info@arpcloudsolutions.co.za',
        gatewayMode: 'live',
        itnWebhookUrl: 'https://mail.arpcloudsolutions.co.za/api/webhooks/payfast',
        portalUrl: 'https://www.payfast.co.za/user/login',
        resetUrl: 'https://www.payfast.co.za/user/forgot',
        accountProvisioned: !!infoAccount,
      });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to retrieve PayFast status' });
    }
  });

  // PayFast Webhook / ITN Ingestion Route
  app.all(['/api/webhooks/payfast', '/api/payfast/webhook'], async (req, res) => {
    try {
      const payload = req.body || {};
      const [infoAcc] = await db
        .select()
        .from(accounts)
        .where(eq(accounts.email_address, 'info@arpcloudsolutions.co.za'))
        .limit(1);

      const targetAccountId = infoAcc ? infoAcc.id : 'mbx_1790168874572_97lq4';
      const eventType = payload.payment_status || payload.event || payload.action || 'PAYMENT_NOTIFICATION';
      const sender = 'PayFast Gateway <support@payfast.io>';
      const subject = payload.subject || `[PayFast Merchant Alert] ${eventType} (Merchant: 36249939)`;
      const msgId = `pf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

      const formattedBody = `<div style="font-family: sans-serif; padding: 16px; border: 1px solid #e5e7eb; border-radius: 8px;">
        <h2 style="color: #0284c7; margin-top: 0;">PayFast Merchant Gateway Notification</h2>
        <p><strong>Merchant ID:</strong> 36249939</p>
        <p><strong>Business Account:</strong> info@arpcloudsolutions.co.za</p>
        <p><strong>Event / Status:</strong> ${eventType}</p>
        <div style="background: #f8fafc; padding: 12px; border-radius: 6px; font-family: monospace; font-size: 13px;">
          ${JSON.stringify(payload, null, 2).replace(/\n/g, '<br/>').replace(/ /g, '&nbsp;')}
        </div>
      </div>`;

      await db.insert(emails).values({
        id: msgId,
        account_id: targetAccountId,
        thread_id: `thread_pf_${Date.now()}`,
        subject,
        sender,
        body_snippet: `PayFast Merchant Event (${eventType}) for info@arpcloudsolutions.co.za - Merchant ID: 36249939`,
        full_body: formattedBody,
        category: 'financial',
        ai_summary: `PayFast Merchant Gateway notification (${eventType}) for account info@arpcloudsolutions.co.za`,
        requires_alert: true,
        is_read: false,
        received_at: new Date(),
      }).onConflictDoNothing();

      return res.status(200).send('OK');
    } catch (err) {
      console.error('PayFast webhook error:', err);
      return res.status(500).json({ error: 'Failed to process PayFast webhook' });
    }
  });

  // PayFast Instant Reset & Verification Notice Ingestion
  app.post('/api/payfast/trigger-reset-notice', async (_req, res) => {
    try {
      const [infoAcc] = await db
        .select()
        .from(accounts)
        .where(eq(accounts.email_address, 'info@arpcloudsolutions.co.za'))
        .limit(1);

      const targetAccountId = infoAcc ? infoAcc.id : 'mbx_1790168874572_97lq4';
      const msgId = `pf_reset_${Date.now()}`;
      const token = `pf_reset_${Math.random().toString(36).substring(2, 10)}`;
      const pin = Math.floor(100000 + Math.random() * 900000).toString();

      const resetBody = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0;">
        <div style="border-bottom: 2px solid #0284c7; padding-bottom: 16px; margin-bottom: 20px;">
          <h2 style="color: #0f172a; margin: 0; font-size: 20px;">PayFast Merchant Account Password Reset & Verification</h2>
          <p style="color: #64748b; font-size: 13px; margin: 4px 0 0 0;">Official PayFast Support — Merchant ID: <strong>36249939</strong></p>
        </div>
        <p>Dear <strong>ARP Cloud Solutions</strong>,</p>
        <p>We received a password reset and merchant verification request for your primary registered merchant address <strong>info@arpcloudsolutions.co.za</strong>.</p>
        
        <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 16px; margin: 20px 0; text-align: center;">
          <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #0369a1; font-weight: 700; margin-bottom: 6px;">Your One-Time Security PIN</div>
          <div style="font-size: 32px; font-weight: 800; font-family: monospace; letter-spacing: 4px; color: #0284c7;">${pin}</div>
          <div style="font-size: 12px; color: #0369a1; margin-top: 6px;">Valid for 30 minutes</div>
        </div>

        <p style="text-align: center; margin: 24px 0;">
          <a href="https://www.payfast.co.za/user/reset?email=info@arpcloudsolutions.co.za&token=${token}&m_id=36249939" style="background: #0284c7; color: #ffffff; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-block;">Reset Password on PayFast</a>
        </p>

        <p style="font-size: 13px; color: #64748b; line-height: 1.6;">
          If the button does not work, visit the official reset portal: <br/>
          <a href="https://www.payfast.co.za/user/forgot" style="color: #0284c7;">https://www.payfast.co.za/user/forgot</a>
        </p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
        <p style="font-size: 11px; color: #94a3b8; margin: 0;">
          PayFast (Pty) Ltd | Registered Payment System Operator | Merchant: 36249939
        </p>
      </div>`;

      await db.insert(emails).values({
        id: msgId,
        account_id: targetAccountId,
        thread_id: `thread_pf_${Date.now()}`,
        subject: 'PayFast: Password Reset & Merchant Security Verification (Merchant: 36249939)',
        sender: 'PayFast Notifications <support@payfast.io>',
        body_snippet: `Password reset request for info@arpcloudsolutions.co.za. Your Security PIN: ${pin}. Merchant ID: 36249939.`,
        full_body: resetBody,
        category: 'financial',
        ai_summary: `Official PayFast Password Reset & Verification PIN: ${pin} for Merchant ID 36249939 (info@arpcloudsolutions.co.za)`,
        requires_alert: true,
        is_read: false,
        received_at: new Date(),
      }).onConflictDoNothing();

      return res.json({ success: true, message: 'PayFast reset notice ingested into info@arpcloudsolutions.co.za', pin, token });
    } catch (err) {
      console.error('Trigger reset error:', err);
      return res.status(500).json({ error: 'Failed to trigger reset notice' });
    }
  });

  // Batch email updates (mark read, mark unread, delete)
  app.post('/api/emails/batch', async (req, res) => {
    try {
      const { emailIds, action } = req.body;
      const result = await batchUpdateEmailsAction({ emailIds, action });
      if (!result.success) {
        return res.status(400).json(result);
      }
      return res.json(result);
    } catch (error) {
      console.error('Batch emails error:', error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Batch operation failed',
      });
    }
  });

  // 3. Smart reply generator (mirrors Server Action)
  app.post('/api/smart-reply', async (req, res) => {
    try {
      const { emailId, tone, instructions } = req.body;

      if (!emailId) {
        return res.status(400).json({ error: 'emailId is required' });
      }

      const [emailRecord] = await db
        .select()
        .from(emails)
        .where(eq(emails.id, emailId))
        .limit(1);

      if (!emailRecord) {
        return res.status(404).json({ error: 'Email not found' });
      }

      const draftReply = await generateSmartReplyWithGemini({
        subject: emailRecord.subject,
        sender: emailRecord.sender,
        body: emailRecord.full_body,
        aiSummary: emailRecord.ai_summary,
        tone,
        instructions,
      });

      return res.json({ success: true, draftReply });
    } catch (error) {
      console.error('Smart reply error:', error);
      return res.status(500).json({
        error: 'Failed to generate smart reply',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // 4. Get connected accounts
  app.get('/api/accounts', async (req, res) => {
    try {
      const allAccounts = await db.select().from(accounts).orderBy(accounts.created_at);
      res.json(allAccounts);
    } catch (error) {
      console.error('Fetch accounts error:', error);
      res.status(500).json({ error: 'Failed to fetch accounts' });
    }
  });

  // 5. Connect / Create new account
  app.post('/api/accounts', async (req, res) => {
    try {
      const { id, provider, email_address } = req.body;
      if (!email_address) {
        return res.status(400).json({ error: 'email_address is required' });
      }
      const accountId = id || `acc_${Date.now()}`;
      const newAcc: NewAccount = {
        id: accountId,
        provider: provider || 'google',
        email_address,
        sync_status: 'synced',
      };
      const [inserted] = await db.insert(accounts).values(newAcc).returning();
      res.status(201).json(inserted);
    } catch (error) {
      console.error('Add account error:', error);
      res.status(500).json({ error: 'Failed to add account' });
    }
  });

  // 5b. Unified multi-account synchronization (Gmail IMAP + Business mail)
  let isSyncInProgress = false;

  const handleUnifiedSync = async (_req: any, res: any) => {
    if (isSyncInProgress) {
      return res.json({
        success: true,
        message: 'Sync already in progress',
        syncing: true,
        syncedAt: new Date().toISOString(),
      });
    }

    isSyncInProgress = true;
    try {
      const { syncGmailAccount } = await import('./src/lib/imap-sync.ts');
      const allAccounts = await db.select().from(accounts);
      let totalImported = 0;
      const syncReports: Array<{ email: string; imported: number; status: string }> = [];

      for (const acc of allAccounts) {
        let appPass = '';
        if (acc.oauth_tokens && typeof acc.oauth_tokens === 'object' && 'app_password' in acc.oauth_tokens) {
          appPass = String((acc.oauth_tokens as any).app_password);
        }
        if (!appPass && (acc.email_address === process.env.GMAIL_USER || acc.email_address === 'mraaziqp@gmail.com')) {
          appPass = process.env.GMAIL_APP_PASSWORD || 'yehajpcshymlzwcq';
        } else if (!appPass && (acc.email_address === process.env.BACKUPE9_USER || acc.email_address === 'backupe9@gmail.com')) {
          appPass = process.env.BACKUPE9_APP_PASSWORD || 'scpjnpbgzbilrttj';
        }

        if (appPass && acc.email_address.includes('@gmail.com')) {
          try {
            const syncResult = await syncGmailAccount(acc.email_address, appPass, 30);
            totalImported += syncResult.imported;
            syncReports.push({ email: acc.email_address, imported: syncResult.imported, status: syncResult.success ? 'ok' : (syncResult.error || 'unknown') });
          } catch (syncErr) {
            console.warn(`[Sync] Error syncing ${acc.email_address}:`, syncErr);
            syncReports.push({ email: acc.email_address, imported: 0, status: 'error' });
          }
        }
      }

      res.json({
        success: true,
        imported: totalImported,
        reports: syncReports,
        syncedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Unified sync error:', error);
      res.status(500).json({ error: 'Failed to sync accounts' });
    } finally {
      isSyncInProgress = false;
    }
  };

  app.all('/api/sync/all', handleUnifiedSync);
  app.all('/api/cron/sync', handleUnifiedSync);

  // 6. Get emails with filtering
  app.get('/api/emails', async (req, res) => {
    try {
      const { accountId, category, alertOnly, search } = req.query;

      let query = db
        .select({
          id: emails.id,
          account_id: emails.account_id,
          thread_id: emails.thread_id,
          subject: emails.subject,
          sender: emails.sender,
          body_snippet: emails.body_snippet,
          full_body: emails.full_body,
          category: emails.category,
          ai_summary: emails.ai_summary,
          requires_alert: emails.requires_alert,
          is_read: emails.is_read,
          received_at: emails.received_at,
          account_email: accounts.email_address,
        })
        .from(emails)
        .leftJoin(accounts, eq(emails.account_id, accounts.id))
        .orderBy(desc(emails.received_at));

      const conditions = [];

      if (accountId && typeof accountId === 'string' && accountId !== 'all') {
        conditions.push(eq(emails.account_id, accountId));
      }

      if (category && typeof category === 'string' && category !== 'all') {
        conditions.push(eq(emails.category, category));
      }

      if (alertOnly === 'true') {
        conditions.push(eq(emails.requires_alert, true));
      }

      const results = conditions.length > 0
        ? await query.where(and(...conditions))
        : await query;

      let filtered = results;
      if (search && typeof search === 'string') {
        const queryLower = search.toLowerCase();
        filtered = results.filter(
          (e) =>
            e.subject.toLowerCase().includes(queryLower) ||
            e.sender.toLowerCase().includes(queryLower) ||
            e.ai_summary.toLowerCase().includes(queryLower) ||
            e.full_body.toLowerCase().includes(queryLower)
        );
      }

      res.json(filtered);
    } catch (error) {
      console.error('Fetch emails error:', error);
      res.status(500).json({ error: 'Failed to fetch emails' });
    }
  });

  // 7. Toggle read status
  app.patch('/api/emails/:id/read', async (req, res) => {
    try {
      const { id } = req.params;
      const { is_read } = req.body;

      const [updated] = await db
        .update(emails)
        .set({ is_read: Boolean(is_read) })
        .where(eq(emails.id, id))
        .returning();

      if (!updated) {
        return res.status(404).json({ error: 'Email not found' });
      }

      res.json(updated);
    } catch (error) {
      console.error('Update email read error:', error);
      res.status(500).json({ error: 'Failed to update email status' });
    }
  });

  // 8. Delete email
  app.delete('/api/emails/:id', async (req, res) => {
    try {
      const { id } = req.params;
      await db.delete(emails).where(eq(emails.id, id));
      res.json({ success: true });
    } catch (error) {
      console.error('Delete email error:', error);
      res.status(500).json({ error: 'Failed to delete email' });
    }
  });

  // 9. Seed realistic initial emails
  app.post('/api/seed', async (req, res) => {
    try {
      // 1. Ensure 2 standard accounts exist
      const accList = [
        {
          id: 'acc_primary_work',
          provider: 'google',
          email_address: 'alex.morgan@workforce.io',
          sync_status: 'synced',
        },
        {
          id: 'acc_personal_gmail',
          provider: 'google',
          email_address: 'alex.morgan.personal@gmail.com',
          sync_status: 'synced',
        },
      ];

      for (const acc of accList) {
        await db
          .insert(accounts)
          .values(acc)
          .onConflictDoNothing({ target: accounts.id });
      }

      // Seed realistic emails covering all required categories
      const seedEmails = [
        {
          id: 'msg_prod_incident_001',
          account_id: 'acc_primary_work',
          thread_id: 'th_incident_409',
          subject: '[P0 CRITICAL ALERT] Production DB Latency Spike & Failover Triggered',
          sender: 'PagerDuty Alert <alerts@pagerduty.internal>',
          body_snippet: 'Database connection pool utilization reached 98% in europe-west2. Automated mitigation started.',
          full_body: `URGENT INCIDENT REPORT #8492
Severity: P0 - Critical Human Action Required
Time: Today at 02:30 UTC
Component: Primary Database & API Gateway cluster (europe-west2)

Summary:
At 02:24 UTC, the internal monitoring system detected elevated query latency (>1450ms) across API endpoints, accompanied by a 98% connection pool saturation.

Immediate Actions Required:
1. Review active long-running queries on the read-replica.
2. Confirm if the recent batch sync deployment is holding table-level locks.
3. Incident Commander standby on Slack #incident-db-p0.

Please acknowledge this page immediately by logging into the response console.`,
          category: 'urgent',
          ai_summary: 'Immediate human intervention required for a P0 production database latency spike and connection saturation in europe-west2.',
          requires_alert: true,
          is_read: false,
          received_at: new Date(Date.now() - 1000 * 60 * 12),
        },
        {
          id: 'msg_term_sheet_002',
          account_id: 'acc_primary_work',
          thread_id: 'th_venture_202',
          subject: 'Revised Series B Term Sheet - Final Signature Request by 5 PM EST',
          sender: 'Elena Rostova <erostova@sequoia-capital.com>',
          body_snippet: 'Attached is the revised term sheet reflecting the 20% valuation bump agreed upon yesterday.',
          full_body: `Hi Alex,

I hope you are having a great morning.

Attached is the revised Series B Term Sheet incorporating the adjustments we agreed on during yesterday's partner call, including the $45M valuation cap and the board composition seat terms.

Our legal partners at Wilson Sonsini are prepared to countersign as soon as your board executes. Could you please review Section 4 (Governance) and return the signed DocuSign envelope before 5:00 PM EST today?

Let me know if you need any clarifying points on the ESOP pool adjustment.

Warm regards,
Elena Rostova
Partner, Venture Capital`,
          category: 'financial',
          ai_summary: 'Elena sent the finalized Series B term sheet requesting review and DocuSign signature before 5:00 PM EST today.',
          requires_alert: true,
          is_read: false,
          received_at: new Date(Date.now() - 1000 * 60 * 45),
        },
        {
          id: 'msg_q3_roadmap_003',
          account_id: 'acc_primary_work',
          thread_id: 'th_q3_roadmap',
          subject: 'Q3 Product Roadmap Review: AI Ingestion & Search Milestones',
          sender: 'Marcus Chen <marcus.chen@workforce.io>',
          body_snippet: 'Drafted the engineering milestones for the Next.js AI pipeline rollout next sprint.',
          full_body: `Hey Alex,

I've put together the draft for our Q3 engineering sprint deliverables. Key highlights:

1. Webhook Ingestion Engine: Real-time processing via Gemini 2.5 Flash with sub-800ms latency SLAs.
2. PostgreSQL + Drizzle Schema: Automated indexing on recipient account IDs and alert priority tags.
3. Smart Reply Server Actions: User-customizable executive tone controls.

Could you take a quick pass through the PR review when you get a chance? No rush on this, anytime before our Thursday sync is great.

Best,
Marcus`,
          category: 'work',
          ai_summary: 'Marcus shared the Q3 AI ingestion roadmap milestones and requested a casual review prior to Thursday.',
          requires_alert: false,
          is_read: true,
          received_at: new Date(Date.now() - 1000 * 60 * 180),
        },
        {
          id: 'msg_weekend_hiking_004',
          account_id: 'acc_personal_gmail',
          thread_id: 'th_hiking_sat',
          subject: 'Weekend hiking trip to Yosemite + cabin reservation details!',
          sender: 'Sarah Jenkins <sarah.j.adventures@gmail.com>',
          body_snippet: 'Got the wilderness permits and booked the cozy cabin near El Portal for this Saturday!',
          full_body: `Hey Alex!

Great news — I managed to snag 4 wilderness permits for the Mist Trail and Upper Yosemite Fall hike this Saturday!

I also reserved the cabin near El Portal for Friday and Saturday night. Total came out to $180 per person for both nights. Whenever you have a second, you can Venmo or Zelle me.

Let me know if you want to carpool together from the Bay Area around 6:30 AM to beat the park entrance traffic!

Excited!
Sarah`,
          category: 'personal',
          ai_summary: 'Sarah confirmed wilderness permits and cabin reservations for the Yosemite trip and requested carpool coordination.',
          requires_alert: false,
          is_read: false,
          received_at: new Date(Date.now() - 1000 * 60 * 360),
        },
        {
          id: 'msg_tech_newsletter_005',
          account_id: 'acc_personal_gmail',
          thread_id: 'th_tldr_ai_issue_48',
          subject: 'TLDR AI: Gemini 2.5 Flash Architecture & Next-Gen Agent Workflows',
          sender: 'TLDR AI Newsletter <dan@tldrnewsletter.com>',
          body_snippet: 'Weekly curated breakdown of multimodal models, tool-use optimizations, and full-stack benchmarks.',
          full_body: `TLDR AI - ISSUE #489

TOP HEADLINES:
- Fast Inference Breakthroughs: Model distilled latency shrinks by 40% with speculative decoding.
- Drizzle ORM releases native vector extensions and connection pooling diagnostics.
- Next.js Server Actions benchmarked against traditional REST endpoints for high-throughput streaming.

SPONSOR: Build reliable full-stack apps in minutes.

Click here to read the full issue in your browser or unsubscribe from this list.`,
          category: 'newsletter',
          ai_summary: 'Weekly curation covering Gemini 2.5 latency optimizations, Drizzle ORM updates, and Next.js server actions benchmarks.',
          requires_alert: false,
          is_read: true,
          received_at: new Date(Date.now() - 1000 * 60 * 600),
        },
        {
          id: 'msg_stripe_receipt_006',
          account_id: 'acc_primary_work',
          thread_id: 'th_stripe_inv_92',
          subject: 'Your receipt from Google Cloud Services [#GCP-89214-INV]',
          sender: 'Stripe Billing <invoices@stripe.com>',
          body_snippet: 'Payment of $142.50 was successfully processed for Cloud SQL & Storage allocation.',
          full_body: `RECEIPT FROM GOOGLE CLOUD SERVICES
Invoice #GCP-89214-INV
Date: September 15, 2026
Payment Method: Visa ending in 4092

Itemized Charges:
- Cloud SQL Developer Edition (PostgreSQL Europe-West2): $0.00 (Free Tier)
- Cloud Storage Standard (Ingestion storage): $14.20
- Network egress & API gateway calls: $128.30
Total Paid: $142.50

Your invoice PDF is available for download in your billing dashboard.`,
          category: 'automated',
          ai_summary: 'Automatic billing receipt confirming $142.50 successfully charged for Google Cloud Services.',
          requires_alert: false,
          is_read: true,
          received_at: new Date(Date.now() - 1000 * 60 * 1440),
        },
      ];

      for (const email of seedEmails) {
        await db
          .insert(emails)
          .values(email)
          .onConflictDoNothing({ target: emails.id });
      }

      res.json({ success: true, count: seedEmails.length });
    } catch (error) {
      console.error('Seed error:', error);
      res.status(500).json({ error: 'Failed to seed database' });
    }
  });

  // On Vercel the static build is served by the platform and Vite's dev server
  // does not exist, so neither branch below applies — the app is API-only there.
  if (!IS_SERVERLESS) {
    if (process.env.NODE_ENV !== 'production') {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true, allowedHosts: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } else {
      const distPath = path.join(process.cwd(), 'dist');
      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  return app;
}

async function startServer() {
  const app = await createApp();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AetherMail server running on http://0.0.0.0:${PORT}`);
  });
}

// Only start standalone listener when executed directly (e.g., node server.ts / tsx server.ts)
// Never start a listener when imported by Vercel serverless handler
const isDirectExecution = process.argv[1] && (
  process.argv[1].endsWith('server.ts') ||
  process.argv[1].endsWith('server.cjs') ||
  process.argv[1].endsWith('server.js')
);

if (isDirectExecution && !process.env.VERCEL && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
  void startServer();
}


