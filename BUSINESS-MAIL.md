# Business mail for arpcloudsolutions.co.za — runbook

Status as of 2026-09-29. **Decision: Resend handles both sending and
receiving** (Zoho dropped). The code is finished and tested; going live is one
script run on a machine logged in to AWS and Vercel.

## Go live — one command

```bash
git pull                                   # main, after the PR merge
npm ci
aws login                                  # Route 53 for arpcloudsolutions.co.za
npx vercel login
export RESEND_API_KEY=re_...               # FULL-access key (resend.com/api-keys)
export DATABASE_URL='postgresql://...'     # Neon pooled URL with headroom (first run)
./scripts/go-live.sh --dry-run             # read-only: shows every change
./scripts/go-live.sh                       # does it
```

What it does, in order (safe to re-run; it only changes what is missing):

1. **Resend** — adds `arpcloudsolutions.co.za` (sending + receiving) and reads
   the DNS records Resend generates for it.
2. **Route 53** — backs up the zone, then writes: Resend DKIM
   (`resend._domainkey`), the `send.` MX + SPF, the **receiving MX** on the
   apex, the `aethermail.` A record → Vercel, SPF (merged with anything already
   there) and DMARC. It refuses to replace an apex MX that is not Resend's.
3. **Resend** — triggers verification and waits for it, then creates the
   `email.received` webhook → `https://aethermail.arpcloudsolutions.co.za/api/webhooks/resend`.
4. **Vercel** — sets `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `ADMIN_PASSWORD`
   (generated and printed once if you have none), `APP_SECRET`, `CRON_SECRET`,
   the business identity, and `DATABASE_URL` if given; attaches
   `aethermail.arpcloudsolutions.co.za`; deploys to production.
5. **GitHub** — sets `AETHERMAIL_URL` + `CRON_SECRET` for the 5-minute sync job
   (needs `gh auth login`; otherwise it tells you to add them by hand).
6. **Checks** — DNS answers and `https://aethermail.arpcloudsolutions.co.za/api/health?deep=1`.

Then: from Gmail, send to `contact@arpcloudsolutions.co.za` → it appears in
AetherMail within seconds. Reply from AetherMail → in the recipient's
"Show original", SPF, DKIM and DMARC all say PASS.

If Resend's API does not return a receiving MX (receiving not enabled for the
domain), the script says so: enable **Receiving** on the domain in the Resend
dashboard and re-run, or pass `RESEND_INBOUND_MX=<host shown there>`.

## How mail flows

| Concern | Lives at |
|---|---|
| **Receiving** | MX → Resend → signed webhook → AetherMail (every address on the domain; unknown ones get a mailbox automatically) |
| **Sending** | AetherMail → Resend API (DKIM-signed as the domain) |
| **Console** | `https://aethermail.arpcloudsolutions.co.za` — Vercel + Neon, installable on phone/desktop |

Resilience: Resend keeps every received message and retries the webhook when
AetherMail is unreachable, so an outage of Vercel or Neon delays mail — it
does not lose it. Received messages can also be read in the Resend dashboard
(Emails → Receiving) at any time.

Mailboxes seeded automatically: `contact@`, `info@`, `sales@`, `billing@`
(`BUSINESS_MAILBOXES`). Add more under **Mailboxes + → Business address
(Resend)**; no password is involved. Gmail and other external mailboxes can
still be connected over IMAP alongside.

## Why it did not work before

1. The domain had **no MX, SPF, DKIM or DMARC** — nothing on the internet knew
   where to deliver its mail. (Fixed by `scripts/go-live.sh`.)
2. Mailboxes connected in the UI **never saved their password**, so every sync
   after the first silently skipped them — "delayed / sometimes slow to update".
3. Every 30 s the browser made the server re-download the newest 30 full
   messages from every mailbox, one account at a time, then pulled every email
   body in the database back to the browser. That was the slowness, and very
   likely what used up the Neon quota.

All of 2 and 3 is fixed: incremental UID sync (a no-change check of two
mailboxes takes ~0.3 s), passwords stored encrypted, bodies fetched only when a
message is opened, IMAP IDLE push on a long-running server (new mail visible in
~2 s), and a 5-minute scheduler for the serverless deployment.

## Manual equivalent (no script)

- Resend dashboard → Domains → Add `arpcloudsolutions.co.za`, enable Receiving.
- Put each record Resend shows into Route 53 (Consolidated-Hub has helpers:
  `add-verification.sh resend-dkim …` and `resend-send us-east-1`), plus the
  receiving MX on the apex. `Consolidated-Hub/scripts/dns/apply-dns.sh` writes
  the `aethermail.` A record, SPF and DMARC.
- Resend → Webhooks → add `https://aethermail.arpcloudsolutions.co.za/api/webhooks/resend`,
  event `email.received`; copy the signing secret.
- Vercel → env vars as listed in `.env.example`, Domains → add the subdomain, redeploy.

## Do not self-host the MX

Measured on the old laptop: port 25 is blocked both ways, it sits behind NAT,
Cloudflare Tunnel carries HTTP only, and a residential IP is on the Spamhaus
PBL.
