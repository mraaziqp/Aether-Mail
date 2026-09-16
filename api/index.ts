/**
 * Vercel serverless entry point.
 *
 * Vercel imports a handler rather than running a long-lived process, so this
 * builds the Express app once per warm instance and hands each request to it.
 * server.ts skips listen() and Vite when VERCEL is set, which is what makes the
 * same routes work both here and on the laptop.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from '../server.ts';

// Built once and reused across invocations on a warm instance; rebuilding the
// router per request would add latency to every call.
let appPromise: ReturnType<typeof createApp> | null = null;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!appPromise) appPromise = createApp();
  const app = await appPromise;
  return (app as unknown as (q: IncomingMessage, s: ServerResponse) => void)(req, res);
}
