import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { extractTokenFromRequest, validateApiKey } from '../lib/api-auth.ts';

/**
 * Operator login for the web console.
 *
 * Sessions are stateless HMAC-signed tokens in an HttpOnly cookie, so they
 * survive serverless cold starts without a sessions table. The signing key is
 * derived from APP_SECRET (or ADMIN_PASSWORD when APP_SECRET is absent), so
 * rotating either one signs everybody out — which is what you want after a leak.
 *
 * ADMIN_PASSWORD has no default. This app previously shipped with a literal
 * fallback password, which made every deployment's inbox readable by anyone
 * who had seen the repo.
 */

const COOKIE = 'am_session';
const SESSION_DAYS = 30;

export interface SessionUser {
  username: string;
  displayName: string;
  role: string;
  primaryEmail: string;
  domain: string;
}

export function adminUsername() {
  return process.env.ADMIN_USERNAME?.trim() || 'mraaziqp';
}

export function isAuthConfigured() {
  return Boolean(process.env.ADMIN_PASSWORD?.trim());
}

export function sessionUser(): SessionUser {
  return {
    username: adminUsername(),
    displayName: process.env.ADMIN_DISPLAY_NAME?.trim() || adminUsername(),
    role: 'Administrator',
    primaryEmail: process.env.ADMIN_EMAIL?.trim() || process.env.AETHERMAIL_SENDER?.trim() || '',
    domain: process.env.BUSINESS_DOMAIN?.trim() || (process.env.AETHERMAIL_SENDER?.split('@')[1] ?? ''),
  };
}

function signingKey(): Buffer {
  const base = process.env.APP_SECRET?.trim() || process.env.ADMIN_PASSWORD?.trim();
  if (!base) throw new Error('ADMIN_PASSWORD is not configured');
  return crypto.createHash('sha256').update(`aethermail:session:${base}`).digest();
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function issueSessionToken(username: string): string {
  const payload = Buffer.from(
    JSON.stringify({ u: username, exp: Date.now() + SESSION_DAYS * 86_400_000, n: crypto.randomBytes(6).toString('hex') })
  ).toString('base64url');
  const mac = crypto.createHmac('sha256', signingKey()).update(payload).digest('base64url');
  return `am1.${payload}.${mac}`;
}

export function verifySessionToken(token: string | null | undefined): { username: string } | null {
  if (!token || !token.startsWith('am1.') || !isAuthConfigured()) return null;
  const [, payload, mac] = token.split('.');
  if (!payload || !mac) return null;
  const expected = crypto.createHmac('sha256', signingKey()).update(payload).digest('base64url');
  if (!safeEqual(mac, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { u: string; exp: number };
    if (typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    return { username: data.u };
  } catch {
    return null;
  }
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0 && part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

function sessionFromRequest(req: Request) {
  const cookie = verifySessionToken(readCookie(req, COOKIE));
  if (cookie) return cookie;
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer am1.')) return verifySessionToken(auth.slice(7).trim());
  return null;
}

function isHttps(req: Request) {
  return req.secure || req.headers['x-forwarded-proto'] === 'https' || !!process.env.VERCEL;
}

function setSessionCookie(req: Request, res: Response, token: string, maxAgeSeconds: number) {
  const parts = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (isHttps(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

// Naive per-IP throttle. Per-instance on serverless, which still turns an
// unlimited online guessing attack into a slow one.
const failures = new Map<string, { count: number; until: number }>();

export function handleLogin(req: Request, res: Response) {
  if (!isAuthConfigured()) {
    return res.status(503).json({
      success: false,
      error: 'Login is not configured on the server. Set ADMIN_PASSWORD (and APP_SECRET) in the environment, then redeploy.',
    });
  }

  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  const f = failures.get(ip);
  if (f && f.count >= 5 && f.until > Date.now()) {
    return res.status(429).json({ success: false, error: 'Too many failed attempts. Try again in a minute.' });
  }

  const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
  const ok =
    typeof username === 'string' &&
    typeof password === 'string' &&
    safeEqual(username.trim().toLowerCase(), adminUsername().toLowerCase()) &&
    safeEqual(password, process.env.ADMIN_PASSWORD!.trim());

  if (!ok) {
    const next = { count: (f && f.until > Date.now() ? f.count : 0) + 1, until: Date.now() + 60_000 };
    failures.set(ip, next);
    return res.status(401).json({ success: false, error: 'Invalid username or password.' });
  }

  failures.delete(ip);
  const token = issueSessionToken(adminUsername());
  setSessionCookie(req, res, token, SESSION_DAYS * 86_400);
  return res.json({ success: true, user: sessionUser() });
}

export function handleLogout(req: Request, res: Response) {
  setSessionCookie(req, res, '', 0);
  res.json({ success: true });
}

export function handleSessionStatus(req: Request, res: Response) {
  const session = sessionFromRequest(req);
  res.json({
    authenticated: Boolean(session),
    configured: isAuthConfigured(),
    user: session ? sessionUser() : null,
  });
}

/** Guards console routes: a valid session cookie (or `Bearer am1.` token) is required. */
export function requireSession(req: Request, res: Response, next: NextFunction) {
  if (sessionFromRequest(req)) return next();
  return res.status(401).json({ success: false, error: 'Not signed in.' });
}

/**
 * For /api/v1 management routes, which both the console (session) and admin
 * bots (API key with `admin` scope) legitimately call.
 */
export function requireSessionOrApiKey(scope = 'admin') {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (sessionFromRequest(req)) return next();
    const auth = await validateApiKey(extractTokenFromRequest(req), scope);
    if (auth.valid) {
      (req as Request & { apiKey?: unknown }).apiKey = auth.apiKey;
      return next();
    }
    return res.status(auth.statusCode || 401).json({ success: false, error: auth.error || 'Not signed in.' });
  };
}

/**
 * Scheduler auth for /api/cron/sync. Vercel Cron sends `Authorization: Bearer
 * $CRON_SECRET` automatically when CRON_SECRET is set; the GitHub Actions
 * workflow sends the same header. A signed-in session is accepted too.
 */
export function requireCronOrSession(req: Request, res: Response, next: NextFunction) {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = req.headers.authorization;
  if (secret && auth && safeEqual(auth, `Bearer ${secret}`)) return next();
  return requireSession(req, res, next);
}

export { safeEqual };
