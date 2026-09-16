# Deploying AetherMail to Vercel

The build is ready. Import the repo on Vercel and it will build — but read the
environment section before expecting it to work, because this app is useless
without a database it can actually reach.

## How it is wired

Vercel serves `dist/` (the Vite front-end) as static files, and routes `/api/*`
to `api/index.ts`, which hands the request to the same Express app that runs on
the laptop. `server.ts` exports `createApp()` and skips `listen()` and Vite's dev
middleware when `VERCEL` is set, so one codebase serves both.

## Environment variables

Set these in **Project → Settings → Environment Variables**.

| Variable | Needed | Notes |
|---|---|---|
| `DATABASE_URL` | **Required** | Must be a **cloud** Postgres — Neon, Supabase, Vercel Postgres. |
| `GEMINI_API_KEY` | Strongly advised | Without it, classification falls back to keyword matching. |
| `EMAIL_SYNC_API_URL` | For sending | A publicly reachable SMTP bridge (EmailEngine). |
| `EMAIL_SYNC_API_KEY` | With the above | Bearer token for that bridge. |
| `NTFY_TOPIC` | Optional | Push alerts for urgent mail. |

### The laptop database will not work

Locally this runs against `postgresql://moh@127.0.0.1:5433/aethermail`. That
address means *this machine*, so from Vercel it resolves to the serverless
container itself and fails. A deployment pointed at it will build, serve the UI,
and error on every request that touches data.

You need either a cloud Postgres, or the laptop's database exposed through the
Cloudflare tunnel — the former is simpler and does not depend on your laptop
being awake.

### Classification without a Gemini key

On the laptop, classification uses the local model at `localhost:11434`. That is
also unreachable from Vercel. Without `GEMINI_API_KEY` the deployment silently
degrades to keyword matching — it still files mail, just less intelligently.

## Create the schema

Against the cloud database, once:

```bash
DATABASE_URL="<your cloud url>" npx drizzle-kit push
```

## What still does not work anywhere

**Sending and receiving real mail.** There are no SMTP or IMAP libraries in this
project; it was designed to sit behind **EmailEngine**, which does the actual
mail transport and exposes REST. Until that exists:

- inbound works only via `POST /api/webhooks/email` (something must push to it)
- outbound returns an explicit error rather than pretending to succeed

That last part was deliberate — the send path used to report success for mail it
had never sent.
