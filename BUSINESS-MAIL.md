# Business mail for arpcloudsolutions.co.za — runbook

Status as of 2026-09-29. The code side is finished and tested end-to-end
against a real IMAP/SMTP server; what remains is account and DNS setup that
needs your logins. Work through the steps in order — each one says how to
check it worked.

## The shape that works 24/7

| Concern | Lives at | Depends on |
|---|---|---|
| **Receiving** (MX) | Zoho Mail | Zoho only |
| **Real inboxes** (`contact@`, aliases `info@`, `sales@`, `billing@`) | Zoho webmail + mobile app | Zoho only |
| **Sending** as the domain | Resend (primary), Zoho SMTP (automatic fallback) | Resend / Zoho |
| **Unified console**, triage, alerts | AetherMail on Vercel at `aethermail.arpcloudsolutions.co.za` | Vercel + Neon |

The point of the split: **business mail never depends on AetherMail being
up.** If Vercel or Neon has a bad day, mail still arrives at Zoho and can be
read and answered in the Zoho app. AetherMail catches up the moment it is back:
the sync tracks the last message it saw per folder, so nothing is skipped.

## Why it did not work before

1. The domain had **no MX, SPF, DKIM or DMARC** — nothing on the internet knew
   where to deliver its mail. (Not fixable in code; step 1 below.)
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

---

## Step 1 — DNS (Route 53)

Tooling is in `mraaziqp/Consolidated-Hub` → `scripts/dns/`.

```bash
aws login
cd Consolidated-Hub/scripts/dns
./apply-dns.sh            # dry run: current vs intended
./apply-dns.sh --apply    # A records for mail./aethermail. → Vercel, Zoho MX, SPF, DMARC
```

Check: `dig +short MX arpcloudsolutions.co.za` shows the three `mx*.zoho.com`
hosts. (If your Zoho account is in the EU data centre, edit
`route53-core.json` to the `mx*.zoho.eu` set first.)

## Step 2 — Zoho: account, domain, mailbox

1. Sign up at <https://www.zoho.com/mail/> → *add an existing domain* →
   `arpcloudsolutions.co.za`.
2. Verify the domain: `./add-verification.sh zoho-verify-cname zbXXXXXXXX --apply`
3. Create the `contact@` user. Add `info@`, `sales@`, `billing@` as **aliases**
   of it (Zoho Admin → Users → contact → Email aliases), so everything lands in
   one mailbox AetherMail watches.
4. DKIM: Zoho Admin → Email Authentication → DKIM → add selector `zoho`, then
   `./add-verification.sh zoho-dkim zoho "v=DKIM1; k=rsa; p=…" --apply` and
   click *Verify* in Zoho.

> **Check the plan includes IMAP.** AetherMail reads the mailbox over IMAP.
> Zoho's *Forever Free* plan has, at times, been web/mobile-only with IMAP
> reserved for paid plans (Mail Lite is about $1/user/month). Confirm on Zoho's
> pricing page before relying on it. If IMAP is unavailable, see *Alternative:
> receive through Resend* below.

5. Enable IMAP: Zoho Mail → Settings → Mail Accounts → IMAP Access → on.
6. Create an **app password**: accounts.zoho.com → Security → App Passwords.

Check: send a message from any outside address (e.g. your Gmail) to
`contact@arpcloudsolutions.co.za`; it appears in Zoho webmail.

## Step 3 — Resend: verify the domain for sending

1. <https://resend.com/domains> → Add domain → `arpcloudsolutions.co.za`.
2. Resend shows three records. Apply them:
   ```bash
   ./add-verification.sh resend-dkim "p=MIGf…" --apply
   ./add-verification.sh resend-send us-east-1 --apply   # use the region Resend shows
   ```
   The `send.` MX + SPF pair is the part most often missed — without it the
   domain stays "pending" and Resend refuses to send as `contact@`.
3. Click *Verify* in Resend.

Until Resend verifies, AetherMail still sends: it falls back to Zoho's SMTP
using the mailbox's own password, and says which route was used.

## Step 4 — Vercel: environment and custom domain

Project → Settings → Environment Variables (Production):

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon **pooled** connection string of a project with headroom |
| `ADMIN_PASSWORD` | a strong password (there is no default any more) |
| `APP_SECRET` | `openssl rand -base64 32` — keep it stable |
| `CRON_SECRET` | `openssl rand -hex 24` |
| `RESEND_API_KEY` | your Resend key |
| `AETHERMAIL_SENDER` | `contact@arpcloudsolutions.co.za` |
| `BUSINESS_NAME` | `ARP Cloud Solutions` |
| `BUSINESS_DOMAIN` | `arpcloudsolutions.co.za` |
| `APP_URL` | `https://aethermail.arpcloudsolutions.co.za` |
| `GEMINI_API_KEY` | optional — AI triage, summaries, smart reply |
| `NTFY_TOPIC` | optional — a long random string for phone alerts |

Project → Settings → Domains → add `aethermail.arpcloudsolutions.co.za` (and
`mail.` if you want it too). The A records from step 1 already point there;
Vercel issues the certificate automatically.

Redeploy. The database schema is created/upgraded automatically on the first
request — no `db:push` needed (it is still safe to run).

Check: `https://aethermail.arpcloudsolutions.co.za/api/health?deep=1` returns
`"database":"ok"`.

## Step 5 — Connect the mailbox in AetherMail

Sign in → **Mailboxes +** → *Zoho (business domain)* → `contact@…`, the app
password from step 2, display name `ARP Cloud Solutions`. The login is tested
before anything is saved, and the last 50 messages are imported immediately.

Hosts for a Zoho **custom-domain** mailbox are `imappro.zoho.com` /
`smtppro.zoho.com` (EU: `imappro.zoho.eu` / `smtppro.zoho.eu`). `imap.zoho.com`
is only for personal `@zoho.com` addresses.

## Step 6 — Keep it syncing when nobody has the console open

GitHub → this repo → Settings → Secrets and variables → Actions:

- `AETHERMAIL_URL` = `https://aethermail.arpcloudsolutions.co.za`
- `CRON_SECRET` = same value as in Vercel

`.github/workflows/mail-sync.yml` then pulls new mail every 5 minutes (Vercel's
Hobby plan only allows a daily cron). With the console open, it also syncs every
30 s in the foreground. For true push (~2 s), run the server long-lived instead
of on Vercel: `npm run build && npm start` on any always-on machine or VPS —
IMAP IDLE switches on automatically.

## Step 7 — Verify end to end

```bash
dig +short MX  arpcloudsolutions.co.za
dig +short TXT arpcloudsolutions.co.za
dig +short TXT _dmarc.arpcloudsolutions.co.za
dig +short MX  send.arpcloudsolutions.co.za
dig +short A   aethermail.arpcloudsolutions.co.za
```

1. Outside address → `contact@`: arrives in Zoho, then in AetherMail within
   5 minutes (seconds if the console is open).
2. Reply from AetherMail: arrives at the outside address. Open the original
   headers and check `spf=pass`, `dkim=pass`, `dmarc=pass`.
3. AetherMail → **Sync health**: every mailbox green, "Resend sending" ticked.

Once 2 has passed for a week or two, DMARC can move from `p=quarantine` to
`p=reject`.

---

## Alternative: receive through Resend

If Zoho's plan has no IMAP and you do not want to pay for it, point the MX at
Resend's inbound servers instead of Zoho and set in Vercel:

- `RESEND_WEBHOOK_SECRET` — from the Resend webhook you create for the
  `email.received` event, URL `https://aethermail.arpcloudsolutions.co.za/api/webhooks/resend`
- `RESEND_API_KEY` must be **full access** (a send-only key cannot read bodies).

Every address on the domain is then captured (a mailbox row is created per
recipient automatically), signatures are verified, and duplicates are ignored.
The trade-off: there is no separate inbox — AetherMail *is* the inbox, so it now
depends on Vercel + Neon being up (Resend retries failed webhooks and keeps the
message, so an outage delays mail rather than losing it).

## Do not self-host the MX

Measured on the old laptop: outbound and inbound port 25 are blocked, it sits
behind NAT, Cloudflare Tunnel carries HTTP only, and a residential IP is on the
Spamhaus PBL. Stalwart there is only useful as a local test server.
