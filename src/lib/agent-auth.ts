import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { db } from '../db/index.ts';
import { agent_keys, type AgentKey, type NewAgentKey } from '../db/schema.ts';
import { eq } from 'drizzle-orm';

export interface ValidatedAgentAuth {
  agentId: string;
  botName: string;
  scopes: string[];
}

/**
 * Computes SHA-256 hash of a raw token string
 */
export function hashAgentKey(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
}

/**
 * Generates a new cryptographically secure root agent key with `jrv_root_` prefix
 */
export function generateAgentKey(
  botName: string = 'Jarvis',
  scopes: string[] = ['super_admin', 'read_all', 'send_as_any']
): { id: string; rawKey: string; keyHash: string; botName: string; scopes: string[] } {
  const entropy = crypto.randomBytes(32).toString('hex');
  const rawKey = `jrv_root_${entropy}`;
  const keyHash = hashAgentKey(rawKey);
  const id = `ak_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

  return {
    id,
    rawKey,
    keyHash,
    botName,
    scopes,
  };
}

/**
 * Validates a raw agent token against the `agent_keys` table and checks required scopes
 */
export async function authenticateAgentToken(
  rawToken: string,
  requiredScope?: string
): Promise<{ valid: boolean; error?: string; agent?: ValidatedAgentAuth }> {
  if (!rawToken || !rawToken.startsWith('jrv_root_')) {
    return { valid: false, error: 'Invalid agent authorization header. Key must start with jrv_root_.' };
  }

  const tokenHash = hashAgentKey(rawToken);

  const matched = await db
    .select()
    .from(agent_keys)
    .where(eq(agent_keys.key_hash, tokenHash))
    .limit(1);

  if (matched.length === 0) {
    return { valid: false, error: 'Unauthorized: Agent key not found or revoked.' };
  }

  const agent = matched[0];
  const scopes = agent.scopes || [];

  // super_admin grants all privileges; otherwise check specific scope
  if (requiredScope && !scopes.includes('super_admin') && !scopes.includes(requiredScope)) {
    return {
      valid: false,
      error: `Forbidden: Agent does not hold required scope "${requiredScope}". Current scopes: [${scopes.join(', ')}]`,
    };
  }

  // Update last_active asynchronously (non-blocking)
  db.update(agent_keys)
    .set({ last_active: new Date() })
    .where(eq(agent_keys.id, agent.id))
    .catch((err) => console.warn('Failed to update agent last_active timestamp:', err));

  return {
    valid: true,
    agent: {
      agentId: agent.id,
      botName: agent.bot_name,
      scopes,
    },
  };
}

/**
 * Next.js App Router helper to extract and authenticate an agent token from standard Request
 */
export async function validateAgentRequest(
  request: Request | globalThis.Request,
  requiredScope?: string
): Promise<{ authorized: boolean; response?: Response | globalThis.Response; agent?: ValidatedAgentAuth }> {
  const authHeader =
    'headers' in request && typeof request.headers.get === 'function'
      ? (request as globalThis.Request).headers.get('authorization') || (request as globalThis.Request).headers.get('x-agent-key')
      : (request as any).headers?.authorization || (request as any).headers?.['x-agent-key'];

  if (!authHeader) {
    return {
      authorized: false,
      response: Response.json(
        { success: false, error: 'Missing agent credentials in Authorization or x-agent-key header.' },
        { status: 401 }
      ) as any,
    };
  }

  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim();
  const authResult = await authenticateAgentToken(token, requiredScope);

  if (!authResult.valid) {
    const statusCode = authResult.error?.startsWith('Forbidden') ? 403 : 401;
    return {
      authorized: false,
      response: Response.json({ success: false, error: authResult.error }, { status: statusCode }) as any,
    };
  }

  return { authorized: true, agent: authResult.agent };
}

/**
 * Express middleware for Jarvis root endpoints
 */
export function requireAgentScope(requiredScope?: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers['authorization'] || (req.headers['x-agent-key'] as string);

    if (!authHeader || typeof authHeader !== 'string') {
      return res.status(401).json({
        success: false,
        error: 'Missing agent credentials in Authorization or x-agent-key header.',
      });
    }

    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim();
    const result = await authenticateAgentToken(token, requiredScope);

    if (!result.valid) {
      const statusCode = result.error?.startsWith('Forbidden') ? 403 : 401;
      return res.status(statusCode).json({ success: false, error: result.error });
    }

    (req as any).agent = result.agent;
    next();
  };
}

/**
 * Seeds or returns an active Jarvis root key if none exists
 */
export async function ensureJarvisRootKey(): Promise<{ rawKey?: string; keyInfo: AgentKey }> {
  const existing = await db
    .select()
    .from(agent_keys)
    .where(eq(agent_keys.bot_name, 'Jarvis'))
    .limit(1);

  if (existing.length > 0) {
    return { keyInfo: existing[0] };
  }

  const newKey = generateAgentKey('Jarvis', ['super_admin', 'read_all', 'send_as_any']);
  const newRecord: NewAgentKey = {
    id: newKey.id,
    bot_name: newKey.botName,
    key_hash: newKey.keyHash,
    scopes: newKey.scopes,
    created_at: new Date(),
  };

  const [inserted] = await db.insert(agent_keys).values(newRecord).returning();
  return {
    rawKey: newKey.rawKey,
    keyInfo: inserted,
  };
}
