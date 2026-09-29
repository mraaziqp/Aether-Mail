/**
 * Browser-side API helper. The session lives in an HttpOnly cookie, so there
 * is no token to attach; a 401 anywhere means the session ended and the app
 * should show the login screen.
 */
type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();

export function onUnauthorized(fn: Listener) {
  unauthorizedListeners.add(fn);
  return () => unauthorizedListeners.delete(fn);
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public body?: unknown) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const { json, timeoutMs, ...rest } = init;
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...rest,
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(rest.headers || {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    signal: rest.signal ?? (timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined),
  });
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }

  if (res.status === 401 && !path.startsWith('/api/auth/')) unauthorizedListeners.forEach((fn) => fn());
  if (!res.ok) {
    const msg = (body && typeof body === 'object' && 'error' in body && (body as { error: string }).error) || `Request failed (${res.status})`;
    throw new ApiError(String(msg), res.status, body);
  }
  return body as T;
}
