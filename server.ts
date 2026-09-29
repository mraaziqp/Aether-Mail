import express, { type Request, type Response, type NextFunction } from 'express';
import path from 'path';
import { and, desc, eq, ilike, lt, or, sql } from 'drizzle-orm';
import { db } from './src/db/index.ts';
import { ensureSchema } from './src/db/ensure-schema.ts';
import { accounts, emails, type NewEmail } from './src/db/schema.ts';
import { processEmailWithGemini, generateSmartReplyWithGemini, isAiConfigured } from './src/lib/gemini.ts';
import { sendEmailAction } from './src/app/actions/send-email.ts';
import { smartSearchAction } from './src/app/actions/smart-search.ts';
import { batchUpdateEmailsAction } from './src/app/actions/batch-emails.ts';
import { v1Router } from './src/server/v1-router.ts';
import {
  handleLogin,
  handleLogout,
  handleSessionStatus,
  requireSession,
  requireSessionOrApiKey,
  requireCronOrSession,
  sessionUser,
} from './src/server/auth.ts';
import { publicMailboxConfig } from './src/lib/secrets.ts';
import { syncAllAccounts, syncOneAccount, startBackgroundSync } from './src/lib/sync-runner.ts';
import { resetSyncState } from './src/lib/imap-sync.ts';
import { pushAlert } from './src/lib/notify.ts';
import { businessDomain } from './src/lib/business-mailboxes.ts';

// 3000 is NexussEmu, 3005 Second Brain, 3006 the hub — AetherMail takes 3007.
const PORT = Number(process.env.PORT) || 3007;

/** True when running inside Vercel's serverless runtime rather than on the laptop. */
const IS_SERVERLESS = !!process.env.VERCEL;

type RawRequest = Request & { rawBody?: string };

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const asyncRoute =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

/** Account row as the browser may see it: never the stored credentials. */
function publicAccount(a: typeof accounts.$inferSelect) {
  const { oauth_tokens, sync_lease_until: _lease, ...rest } = a;
  return { ...rest, settings: publicMailboxConfig(oauth_tokens) };
}

/**
 * Builds the configured Express app without binding a port.
 *
 * Split out from startServer so the same routes can be served two ways: by a
 * long-lived process on the laptop, and by Vercel's Node runtime, which imports
 * a handler and must never call listen() or start Vite's dev middleware.
 */
export async function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  // Keep the raw body: webhook signatures are computed over the exact bytes.
  app.use(
    express.json({
      limit: '15mb',
      verify: (req, _res, buf) => {
        (req as RawRequest).rawBody = buf.toString('utf8');
      },
    })
  );
  app.use(express.urlencoded({ extended: false, limit: '1mb', verify: (req, _res, buf) => {
    (req as RawRequest).rawBody = buf.toString('utf8');
  } }));

  // ---------------------------------------------------------------------------
  // Public
  // ---------------------------------------------------------------------------

  app.get('/api/health', async (req, res) => {
    if (req.query.deep !== '1') return res.json({ status: 'ok', time: new Date().toISOString() });
    try {
      await ensureSchema();
      await db.execute(sql`select 1`);
      res.json({ status: 'ok', database: 'ok', time: new Date().toISOString() });
    } catch (err) {
      res.status(503).json({ status: 'degraded', database: (err as Error).message, time: new Date().toISOString() });
    }
  });

  app.get('/api/auth/session', handleSessionStatus);
  app.post('/api/auth/login', handleLogin);
  app.post('/api/auth/logout', handleLogout);

  // Everything below touches the database; make sure the schema is current first.
  app.use('/api', (req, res, next) => {
    ensureSchema().then(
      () => next(),
      (err) => {
        console.error('Database unavailable:', err);
        res.status(503).json({
          success: false,
          error: `Database unavailable: ${(err as Error).message}. Check DATABASE_URL (a Neon project over its quota fails like this too).`,
        });
      }
    );
  });

  // Bot & agent REST API — authenticates itself with API keys.
  app.use('/api/v1', v1Router);

  // Scheduled sync (Vercel Cron / GitHub Actions).
  app.all(
    '/api/cron/sync',
    requireCronOrSession,
    asyncRoute(async (_req, res) => {
      res.json(await syncAllAccounts({ budgetMs: IS_SERVERLESS ? 50_000 : 110_000 }));
    })
  );

  // Resend inbound mail (optional route: MX → Resend → this webhook).
  app.post(
    '/api/webhooks/resend',
    asyncRoute(async (req, res) => {
      const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
      if (!secret) return res.status(503).json({ error: 'RESEND_WEBHOOK_SECRET is not configured.' });
      const { verifySvixSignature, ingestResendEvent } = await import('./src/lib/resend-inbound.ts');
      if (!verifySvixSignature((req as RawRequest).rawBody ?? '', req.headers, secret)) {
        return res.status(401).json({ error: 'Invalid webhook signature.' });
      }
      res.json({ success: true, ...(await ingestResendEvent(req.body)) });
    })
  );

  // PayFast ITN. Every notification is confirmed with PayFast itself before it
  // is stored — this endpoint is public, and an unverified one lets anyone
  // plant convincing "payment received" mail in the business inbox.
  app.post(
    ['/api/webhooks/payfast', '/api/payfast/webhook'],
    asyncRoute(async (req, res) => {
      const merchantId = process.env.PAYFAST_MERCHANT_ID?.trim();
      if (!merchantId) return res.status(503).send('PAYFAST_MERCHANT_ID not configured');

      const payload = (req.body ?? {}) as Record<string, string>;
      if (String(payload.merchant_id ?? '') !== merchantId) return res.status(400).send('merchant mismatch');

      const raw = ((req as RawRequest).rawBody ?? '').replace(/&signature=[^&]*/, '');
      const host = process.env.PAYFAST_SANDBOX === 'true' ? 'sandbox.payfast.co.za' : 'www.payfast.co.za';
      const check = await fetch(`https://${host}/eng/query/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: raw,
        signal: AbortSignal.timeout(10_000),
      }).then((r) => r.text()).catch(() => 'ERROR');
      if (check.trim() !== 'VALID') return res.status(400).send('ITN not confirmed by PayFast');

      const notifyAddr = process.env.PAYFAST_NOTIFY_EMAIL?.trim().toLowerCase();
      const [target] = notifyAddr
        ? await db.select().from(accounts).where(eq(accounts.email_address, notifyAddr)).limit(1)
        : await db.select().from(accounts).orderBy(accounts.created_at).limit(1);
      if (!target) return res.status(200).send('OK (no account to file under)');

      const status = payload.payment_status || 'NOTIFICATION';
      const amount = payload.amount_gross ? `R${payload.amount_gross}` : '';
      const rows = Object.entries(payload)
        .filter(([k]) => k !== 'signature')
        .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#64748b">${escapeHtml(k)}</td><td style="padding:4px 0;font-family:monospace">${escapeHtml(String(v))}</td></tr>`)
        .join('');
      const subject = `PayFast ${status}${amount ? ` · ${amount}` : ''}${payload.item_name ? ` · ${payload.item_name}` : ''}`;

      await db.insert(emails).values({
        id: `pf:${payload.pf_payment_id || Date.now()}:${status}`,
        account_id: target.id,
        thread_id: `pf:${payload.m_payment_id || payload.pf_payment_id || Date.now()}`,
        subject,
        sender: 'PayFast ITN <itn@payfast.co.za>',
        body_snippet: `${status} ${amount} ${payload.name_first ?? ''} ${payload.email_address ?? ''}`.trim(),
        full_body: `<h3 style="margin:0 0 12px">Verified PayFast notification</h3><table style="font-size:13px;border-collapse:collapse">${rows}</table>`,
        category: 'financial',
        ai_summary: `PayFast confirmed ${status.toLowerCase()} ${amount}`.trim(),
        requires_alert: status !== 'COMPLETE',
        is_read: false,
        received_at: new Date(),
        direction: 'inbound',
        folder: 'INBOX',
      }).onConflictDoNothing();

      if (status !== 'COMPLETE') void pushAlert({ subject, sender: 'PayFast', summary: `Payment ${status}` });
      return res.status(200).send('OK');
    })
  );

  // ---------------------------------------------------------------------------
  // Console (signed-in operator only)
  // ---------------------------------------------------------------------------

  // Manual ingestion: the console (session) or a bot with a `write` key.
  app.post(
    '/api/webhooks/email',
    requireSessionOrApiKey('write'),
    asyncRoute(async (req, res) => {
      const { id, account_id, thread_id, subject, sender, body_snippet, full_body, received_at } = req.body;
      if (!account_id || !subject || !sender || !full_body) {
        return res.status(400).json({ error: 'account_id, subject, sender and full_body are required.' });
      }
      const [acc] = await db.select().from(accounts).where(eq(accounts.id, account_id)).limit(1);
      if (!acc) return res.status(404).json({ error: `Unknown account_id "${account_id}".` });

      const ai = await processEmailWithGemini({ subject, sender, body: full_body });
      const emailId = id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const record: NewEmail = {
        id: emailId,
        account_id,
        thread_id: thread_id || emailId,
        subject,
        sender,
        body_snippet: body_snippet || String(full_body).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200),
        full_body,
        category: ai.category,
        ai_summary: ai.summary,
        requires_alert: ai.requires_alert,
        is_read: false,
        received_at: received_at ? new Date(received_at) : new Date(),
        direction: 'inbound',
      };
      const inserted = await db.insert(emails).values(record).onConflictDoNothing().returning();
      const alertDispatched = ai.requires_alert ? await pushAlert({ subject, sender, summary: ai.summary }) : false;
      res.status(201).json({ success: true, data: inserted[0] ?? record, alertDispatched });
    })
  );

  app.use('/api', requireSession);

  app.get('/api/auth/me', (_req, res) => res.json({ success: true, user: sessionUser() }));

  /** One cheap call for the header: per-account telemetry, counters and configured capabilities. */
  app.get(
    '/api/status',
    asyncRoute(async (_req, res) => {
      const accs = await db.select().from(accounts).orderBy(accounts.created_at);
      const perAccount = await db
        .select({
          account_id: emails.account_id,
          total: sql<number>`count(*)::int`,
          unread: sql<number>`count(*) filter (where ${emails.is_read} = false and ${emails.direction} = 'inbound' and ${emails.category} <> 'spam')::int`,
          latest: sql<string | null>`max(${emails.received_at})`,
        })
        .from(emails)
        .groupBy(emails.account_id);
      const perCategory = await db
        .select({
          category: emails.category,
          unread: sql<number>`count(*) filter (where ${emails.is_read} = false)::int`,
          total: sql<number>`count(*)::int`,
        })
        .from(emails)
        .groupBy(emails.category);
      const [alerts] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(emails)
        .where(and(eq(emails.requires_alert, true), eq(emails.is_read, false)));
      const [newest] = await db.select({ id: emails.id, at: emails.received_at }).from(emails).orderBy(desc(emails.received_at)).limit(1);

      res.json({
        success: true,
        serverTime: new Date().toISOString(),
        latestEmailId: newest?.id ?? null,
        latestEmailAt: newest?.at ?? null,
        alertCount: alerts?.n ?? 0,
        categories: perCategory,
        accounts: accs.map((a) => ({
          ...publicAccount(a),
          ...(perAccount.find((p) => p.account_id === a.id) ?? { total: 0, unread: 0, latest: null }),
        })),
        capabilities: {
          resend: Boolean(process.env.RESEND_API_KEY?.trim()),
          resendInbound: Boolean(process.env.RESEND_WEBHOOK_SECRET?.trim()),
          smtpRelay: Boolean(process.env.SMTP_HOST?.trim()),
          gmailRelay: Boolean(process.env.GMAIL_USER?.trim() && process.env.GMAIL_APP_PASSWORD?.trim()) && process.env.ALLOW_GMAIL_RELAY !== 'false',
          ai: isAiConfigured(),
          push: Boolean(process.env.NTFY_TOPIC?.trim()),
          credentialVault: Boolean(process.env.APP_SECRET?.trim()),
          backgroundSync: !IS_SERVERLESS && process.env.BACKGROUND_SYNC !== 'false',
          serverless: IS_SERVERLESS,
          defaultSender: process.env.AETHERMAIL_SENDER?.trim() || null,
        },
      });
    })
  );

  app.get(
    '/api/accounts',
    asyncRoute(async (_req, res) => {
      const all = await db.select().from(accounts).orderBy(accounts.created_at);
      res.json(all.map(publicAccount));
    })
  );

  app.post(
    '/api/accounts/connect',
    asyncRoute(async (req, res) => {
      const { connectMailbox } = await import('./src/lib/mailbox-service.ts');
      try {
        const out = await connectMailbox(req.body ?? {});
        res.status(201).json({ success: true, account: publicAccount(out.account), folders: out.folders, report: out.report });
      } catch (err) {
        res.status(400).json({ success: false, error: (err as Error).message });
      }
    })
  );

  /** A business address served by Resend (receives by webhook, sends via API) — no password. */
  app.post(
    '/api/accounts/address',
    asyncRoute(async (req, res) => {
      const email = String(req.body?.email_address ?? '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ success: false, error: 'Enter a valid email address.' });
      const domain = businessDomain();
      if (!domain) return res.status(400).json({ success: false, error: 'Set BUSINESS_DOMAIN (or AETHERMAIL_SENDER) so AetherMail knows which domain Resend serves.' });
      if (!email.endsWith(`@${domain}`)) {
        return res.status(400).json({ success: false, error: `Only addresses on ${domain} can be served by Resend. Use an IMAP preset for other mailboxes.` });
      }
      const display = typeof req.body?.display_name === 'string' ? req.body.display_name.trim() || null : null;
      const [row] = await db
        .insert(accounts)
        .values({ id: `acc_biz_${email.replace(/[^a-z0-9]/g, '_')}`, provider: 'resend', email_address: email, display_name: display, sync_status: 'synced' })
        .onConflictDoUpdate({ target: accounts.email_address, set: { display_name: display } })
        .returning();
      res.status(201).json({ success: true, account: publicAccount(row) });
    })
  );

  app.patch(
    '/api/accounts/:id',
    asyncRoute(async (req, res) => {
      const { display_name } = req.body ?? {};
      const [updated] = await db
        .update(accounts)
        .set({ display_name: typeof display_name === 'string' ? display_name.trim() || null : undefined })
        .where(eq(accounts.id, req.params.id))
        .returning();
      if (!updated) return res.status(404).json({ success: false, error: 'Account not found' });
      res.json({ success: true, account: publicAccount(updated) });
    })
  );

  app.delete(
    '/api/accounts/:id',
    asyncRoute(async (req, res) => {
      const deleted = await db.delete(accounts).where(eq(accounts.id, req.params.id)).returning({ id: accounts.id });
      res.json({ success: deleted.length > 0 });
    })
  );

  /** Re-imports recent mail from scratch for one account (after a server-side folder reset, say). */
  app.post(
    '/api/accounts/:id/resync',
    asyncRoute(async (req, res) => {
      const [acc] = await db.select().from(accounts).where(eq(accounts.id, req.params.id)).limit(1);
      if (!acc) return res.status(404).json({ success: false, error: 'Account not found' });
      await resetSyncState(acc.id);
      res.json(await syncOneAccount(acc, { force: true, deadline: Date.now() + 50_000 }));
    })
  );

  const runSync = asyncRoute(async (req, res) => {
    const force = req.query.force === '1' || req.body?.force === true;
    res.json(await syncAllAccounts({ force, budgetMs: IS_SERVERLESS ? 25_000 : 60_000 }));
  });
  app.post('/api/sync/all', runSync);
  app.get('/api/sync/all', runSync);

  // List view: everything the feed needs and nothing it does not. Bodies are
  // fetched per message on open, which is what keeps polling cheap.
  const listColumns = {
    id: emails.id,
    account_id: emails.account_id,
    thread_id: emails.thread_id,
    subject: emails.subject,
    sender: emails.sender,
    body_snippet: emails.body_snippet,
    category: emails.category,
    ai_summary: emails.ai_summary,
    requires_alert: emails.requires_alert,
    is_read: emails.is_read,
    received_at: emails.received_at,
    recipients: emails.recipients,
    direction: emails.direction,
    folder: emails.folder,
    has_attachments: emails.has_attachments,
    account_email: accounts.email_address,
  };

  app.get(
    '/api/emails',
    asyncRoute(async (req, res) => {
      const { accountId, category, alertOnly, search, unread, direction, before } = req.query as Record<string, string | undefined>;
      const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
      const conds = [];

      if (accountId && accountId !== 'all') conds.push(eq(emails.account_id, accountId));
      if (category === 'sent') conds.push(eq(emails.direction, 'outbound'));
      else if (category && category !== 'all') conds.push(eq(emails.category, category));
      else if (!search) conds.push(sql`${emails.category} <> 'spam'`);
      if (alertOnly === 'true') conds.push(eq(emails.requires_alert, true));
      if (unread === 'true') conds.push(eq(emails.is_read, false));
      if (direction === 'inbound' || direction === 'outbound') conds.push(eq(emails.direction, direction));
      if (before) {
        const d = new Date(before);
        if (!isNaN(d.getTime())) conds.push(lt(emails.received_at, d));
      }
      if (search?.trim()) {
        const q = `%${search.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
        conds.push(
          or(
            ilike(emails.subject, q),
            ilike(emails.sender, q),
            ilike(emails.body_snippet, q),
            ilike(emails.ai_summary, q),
            ilike(emails.recipients, q)
          )!
        );
      }

      const rows = await db
        .select(listColumns)
        .from(emails)
        .leftJoin(accounts, eq(emails.account_id, accounts.id))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(emails.received_at))
        .limit(limit);

      res.json(rows);
    })
  );

  app.get(
    '/api/emails/:id',
    asyncRoute(async (req, res) => {
      const [row] = await db
        .select({ ...listColumns, full_body: emails.full_body, message_id: emails.message_id })
        .from(emails)
        .leftJoin(accounts, eq(emails.account_id, accounts.id))
        .where(eq(emails.id, req.params.id))
        .limit(1);
      if (!row) return res.status(404).json({ error: 'Email not found' });
      res.json(row);
    })
  );

  app.get(
    '/api/threads/:threadId',
    asyncRoute(async (req, res) => {
      const rows = await db
        .select({ ...listColumns, full_body: emails.full_body })
        .from(emails)
        .leftJoin(accounts, eq(emails.account_id, accounts.id))
        .where(eq(emails.thread_id, req.params.threadId))
        .orderBy(emails.received_at)
        .limit(50);
      res.json(rows);
    })
  );

  app.patch(
    '/api/emails/:id/read',
    asyncRoute(async (req, res) => {
      const [updated] = await db
        .update(emails)
        .set({ is_read: Boolean(req.body?.is_read) })
        .where(eq(emails.id, req.params.id))
        .returning({ id: emails.id, is_read: emails.is_read });
      if (!updated) return res.status(404).json({ error: 'Email not found' });
      res.json(updated);
    })
  );

  app.patch(
    '/api/emails/:id',
    asyncRoute(async (req, res) => {
      const { category, requires_alert } = req.body ?? {};
      const valid = ['urgent', 'personal', 'newsletter', 'automated', 'work', 'financial', 'spam'];
      const set: Partial<NewEmail> = {};
      if (typeof category === 'string' && valid.includes(category)) set.category = category;
      if (typeof requires_alert === 'boolean') set.requires_alert = requires_alert;
      if (!Object.keys(set).length) return res.status(400).json({ error: 'Nothing to update' });
      const [updated] = await db.update(emails).set(set).where(eq(emails.id, req.params.id)).returning({ id: emails.id });
      if (!updated) return res.status(404).json({ error: 'Email not found' });
      res.json({ success: true, ...set });
    })
  );

  app.delete(
    '/api/emails/:id',
    asyncRoute(async (req, res) => {
      await db.delete(emails).where(eq(emails.id, req.params.id));
      res.json({ success: true });
    })
  );

  app.post(
    '/api/emails/batch',
    asyncRoute(async (req, res) => {
      const { emailIds, action } = req.body ?? {};
      const result = await batchUpdateEmailsAction({ emailIds, action });
      res.status(result.success ? 200 : 400).json(result);
    })
  );

  app.post(
    '/api/emails/mark-all-read',
    asyncRoute(async (req, res) => {
      const accountId = typeof req.body?.accountId === 'string' && req.body.accountId !== 'all' ? req.body.accountId : null;
      const done = await db
        .update(emails)
        .set({ is_read: true })
        .where(and(eq(emails.is_read, false), accountId ? eq(emails.account_id, accountId) : undefined))
        .returning({ id: emails.id });
      res.json({ success: true, updated: done.length });
    })
  );

  app.post(
    '/api/send-email',
    asyncRoute(async (req, res) => {
      const { accountId, to, cc, bcc, subject, htmlBody, inReplyToId, attachments } = req.body ?? {};
      const result = await sendEmailAction({ accountId, to, cc, bcc, subject, htmlBody, inReplyToId, attachments });
      res.status(result.success ? 200 : 400).json(result);
    })
  );

  app.post(
    '/api/smart-search',
    asyncRoute(async (req, res) => {
      const { query, accountId } = req.body ?? {};
      res.json(await smartSearchAction(query || '', accountId));
    })
  );

  app.post(
    '/api/smart-reply',
    asyncRoute(async (req, res) => {
      const { emailId, tone, instructions } = req.body ?? {};
      if (!emailId) return res.status(400).json({ error: 'emailId is required' });
      const [email] = await db.select().from(emails).where(eq(emails.id, emailId)).limit(1);
      if (!email) return res.status(404).json({ error: 'Email not found' });
      const draftReply = await generateSmartReplyWithGemini({
        subject: email.subject,
        sender: email.sender,
        body: email.full_body.replace(/<style[\s\S]*?<\/style>|<[^>]+>/gi, ' ').replace(/\s+/g, ' ').slice(0, 12000),
        aiSummary: email.ai_summary,
        tone,
        instructions,
      });
      res.json({ success: true, draftReply });
    })
  );

  app.get('/api/payfast/status', (_req, res) => {
    const merchantId = process.env.PAYFAST_MERCHANT_ID?.trim() || null;
    res.json({
      success: true,
      connected: Boolean(merchantId),
      merchantId,
      merchantKeyConfigured: Boolean(process.env.PAYFAST_MERCHANT_KEY?.trim()),
      businessEmail: process.env.PAYFAST_NOTIFY_EMAIL?.trim() || null,
      gatewayMode: process.env.PAYFAST_SANDBOX === 'true' ? 'sandbox' : 'live',
      itnWebhookUrl: process.env.APP_URL ? `${process.env.APP_URL.replace(/\/$/, '')}/api/webhooks/payfast` : null,
      portalUrl: 'https://www.payfast.co.za/user/login',
    });
  });

  // Uniform JSON errors for anything thrown in a route.
  app.use('/api', (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('API error:', err);
    if (res.headersSent) return;
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Internal error' });
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
      app.use(express.static(distPath, { index: false, maxAge: '1h' }));
      app.get('*', (_req, res) => {
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

  if (process.env.BACKGROUND_SYNC !== 'false') {
    ensureSchema().then(startBackgroundSync, (err) =>
      console.error('[sync] background sync not started — database unavailable:', err.message)
    );
  }
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

