/**
 * Vercel serverless entry point source.
 * Bundled by esbuild into api/index.js during build.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from '../../server.ts';

let appPromise: ReturnType<typeof createApp> | null = null;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!appPromise) appPromise = createApp();
  const app = await appPromise;
  return (app as unknown as (q: IncomingMessage, s: ServerResponse) => void)(req, res);
}
