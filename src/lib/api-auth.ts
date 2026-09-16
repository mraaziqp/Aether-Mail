import crypto from 'node:crypto';
import { db } from '../db/index.ts';
import { api_keys, type ApiKey } from '../db/schema.ts';
import { eq } from 'drizzle-orm';
import type { Request, Response, NextFunction } from 'express';

export interface GeneratedKeyResult {
  id: string;
  name: string;
  rawKey: string;
  prefix: string;
  keyHash: string;
  scopes: string[];
}

/**
 * Computes SHA-256 hash of API key for secure persistence
 */
export function hashApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey.trim()).digest('hex');
}

/**
 * Generates a high-entropy secret key with standard `ops_` prefix for autonomous operations
 */
export function generateNewApiKey(name: string, scopes: string[] = ['read']): GeneratedKeyResult {
  const id = `key_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const entropy = crypto.randomBytes(24).toString('base64url');
  const rawKey = `ops_${entropy}`;
  const prefix = `ops_${entropy.slice(0, 6)}...${entropy.slice(-4)}`;
  const keyHash = hashApiKey(rawKey);

  return {
    id,
    name,
    rawKey,
    prefix,
    keyHash,
    scopes,
  };
}

export interface AuthValidationResult {
  valid: boolean;
  apiKey?: ApiKey;
  error?: string;
  statusCode?: number;
}

/**
 * Extracts raw API token from Express Request, Next.js / Web Request, or Headers
 */
export function extractTokenFromRequest(req: Request | globalThis.Request | { headers: any }): string | null {
  let authHeader: string | null = null;
  let xApiKey: string | null = null;

  if ('headers' in req) {
    if (typeof (req.headers as any).get === 'function') {
      // Web Standard Headers (Fetch / Next.js)
      authHeader = (req.headers as Headers).get('authorization');
      xApiKey = (req.headers as Headers).get('x-api-key');
    } else {
      // Express / Node IncomingMessage
      const headers = req.headers as Record<string, string | string[] | undefined>;
      const rawAuth = headers['authorization'];
      authHeader = Array.isArray(rawAuth) ? rawAuth[0] : (rawAuth || null);
      const rawX = headers['x-api-key'];
      xApiKey = Array.isArray(rawX) ? rawX[0] : (rawX || null);
    }
  }

  if (authHeader) {
    if (authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7).trim();
    }
    return authHeader.trim();
  }

  if (xApiKey && typeof xApiKey === 'string' && xApiKey.trim()) {
    return xApiKey.trim();
  }

  return null;
}

/**
 * Validates token and checks required scopes
 */
export async function validateApiKey(
  rawKey: string | null | undefined,
  requiredScope?: string
): Promise<AuthValidationResult> {
  if (!rawKey || typeof rawKey !== 'string') {
    return {
      valid: false,
      error: 'Missing API key. Provide "Authorization: Bearer <token>" or "x-api-key" header.',
      statusCode: 401,
    };
  }

  const hashed = hashApiKey(rawKey);

  try {
    const records = await db
      .select()
      .from(api_keys)
      .where(eq(api_keys.key_hash, hashed))
      .limit(1);

    if (records.length === 0) {
      return {
        valid: false,
        error: 'Invalid or revoked API key.',
        statusCode: 403,
      };
    }

    const key = records[0];

    // Check scope if required
    const scopes = Array.isArray(key.scopes) ? key.scopes : [];
    if (requiredScope && !scopes.includes('admin') && !scopes.includes(requiredScope)) {
      return {
        valid: false,
        error: `Unauthorized: Token requires '${requiredScope}' scope. Granted scopes: [${scopes.join(', ')}]`,
        statusCode: 403,
      };
    }

    // Touch last_used_at asynchronously
    db.update(api_keys)
      .set({ last_used_at: new Date() })
      .where(eq(api_keys.id, key.id))
      .catch((err) => console.warn('Failed to update last_used_at:', err));

    return {
      valid: true,
      apiKey: key,
    };
  } catch (dbErr) {
    console.error('API key verification error:', dbErr);
    return {
      valid: false,
      error: 'Internal authentication error.',
      statusCode: 500,
    };
  }
}

/**
 * Express Middleware to require and validate API Keys with scope enforcement
 */
export function requireApiKey(requiredScope?: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const rawToken = extractTokenFromRequest(req);
    const auth = await validateApiKey(rawToken, requiredScope);

    if (!auth.valid) {
      return res.status(auth.statusCode || 401).json({
        success: false,
        error: auth.error,
      });
    }

    (req as any).apiKey = auth.apiKey;
    next();
  };
}
