# Deploying AetherMail

## Vercel (default)

Vercel serves `dist/` (the Vite front-end) and routes `/api/*` to
`api/index.js`, which hands the request to the same Express app used locally.
`server.ts` exports `createApp()` and skips `listen()` and Vite when `VERCEL` is
set.

**`api/index.js` is a committed build artifact.** After changing anything under
`src/` or `server.ts`, run `npm run build:api` and commit the result — Vercel's
build regenerates it too, but the committed copy must never drift into carrying
old code (this is how hardcoded credentials survived earlier cleanups).

Environment variables are listed in `.env.example`; the minimum is
`DATABASE_URL`, `ADMIN_PASSWORD`, `APP_SECRET`, plus `RESEND_API_KEY` and
`CRON_SECRET` for business mail. The schema is created automatically on first
request. `vercel.json` gives the API function 60 s, and keeps the daily Vercel
cron (the Hobby plan's limit); `.github/workflows/mail-sync.yml` runs the sync
every 5 minutes.

Custom domain: Project → Settings → Domains → `aethermail.arpcloudsolutions.co.za`.
Its A record (76.76.21.21) is written by `Consolidated-Hub/scripts/dns/apply-dns.sh`.

Health: `GET /api/health` (process) and `GET /api/health?deep=1` (database).

## Long-running server (fastest: IMAP IDLE push)

```bash
npm ci
npm run build
npm start            # node --env-file=.env dist/server.cjs, port 3007 by default
```

When not on Vercel, the server keeps an IDLE connection open on every inbox and
runs a full sync every `SYNC_INTERVAL_SECONDS` (default 60). New mail shows up
in about two seconds. Put it behind any HTTPS reverse proxy or a Cloudflare
Tunnel to reach it from anywhere.

## Checks before pushing

```bash
npm run lint         # tsc --noEmit
npm run build        # web + api/index.js + dist/server.cjs
```
