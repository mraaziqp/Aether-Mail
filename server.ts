import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { db } from './src/db/index.ts';
import { accounts, emails, type NewEmail, type NewAccount } from './src/db/schema.ts';
import { processEmailWithGemini, generateSmartReplyWithGemini } from './src/lib/gemini.ts';
import { eq, desc, and } from 'drizzle-orm';
import { sendEmailAction } from './src/app/actions/send-email.ts';
import { smartSearchAction } from './src/app/actions/smart-search.ts';
import { batchUpdateEmailsAction } from './src/app/actions/batch-emails.ts';
import { v1Router } from './src/server/v1-router.ts';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // Mount Bot & Agent Programmatic REST API v1
  app.use('/api/v1', v1Router);

  // 1. Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
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
          await fetch(`https://ntfy.sh/${ntfyTopic}`, {
            method: 'POST',
            headers: {
              'Title': `🚨 [AetherMail Alert] ${subject.slice(0, 60)}`,
              'Priority': 'urgent',
              'Tags': 'warning,rotating_light,email',
              'Click': process.env.APP_URL || 'https://aethermail.internal',
            },
            body: pushBody,
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
      const { accountId, to, subject, htmlBody } = req.body;
      const result = await sendEmailAction({ accountId, to, subject, htmlBody });
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

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AetherMail server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
