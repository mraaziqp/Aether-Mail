/**
 * Minimal Resend REST client shared by sending, inbound fetch and delivery
 * tracking. Env-only: without RESEND_API_KEY every call says so.
 */

export const resendConfigured = () => Boolean(process.env.RESEND_API_KEY?.trim());

const base = () => (process.env.RESEND_API_URL?.trim() || 'https://api.resend.com').replace(/\/$/, '');

export interface ResendResponse<T> {
  ok: boolean;
  status: number;
  body: T & { message?: string; name?: string };
}

export async function resendApi<T = Record<string, unknown>>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string>; timeoutMs?: number } = {}
): Promise<ResendResponse<T>> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) throw new Error('RESEND_API_KEY not set');
  const res = await fetch(`${base()}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${key}`,
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(init.timeoutMs ?? 15_000),
  });
  const body = (await res.json().catch(() => ({}))) as ResendResponse<T>['body'];
  return { ok: res.ok, status: res.status, body };
}
