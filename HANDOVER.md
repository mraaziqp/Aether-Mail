# Handover — business mail for arpcloudsolutions.co.za

Written 2026-09-29 for a fresh session on a new machine. Read
[BUSINESS-MAIL.md](./BUSINESS-MAIL.md) alongside this — it is the runbook, this
is the state of play and what is left.

The work spans **two repos**:

| Repo | Holds |
|---|---|
| `mraaziqp/Aether-Mail` (this one) | the mail app, IMAP sync, send path |
| `mraaziqp/Consolidated-Hub` | the business site **and** `scripts/dns/` — the Route 53 tooling |

Clone both. The DNS scripts are the immediate next step and they live in the other one.

---

## Where things stand

**Business mail has never worked, and it was never a code problem.**
`arpcloudsolutions.co.za` had no MX, no SPF, no DKIM, no DMARC, and no A record
for `mail.` or `aethermail.`. Nothing on the internet knew where to deliver its
mail. Four other subdomains (`templates.`, `builder.`, `raaziq.`, `portfolio.`)
were fine throughout — they resolve to Vercel and return 200.

**Decision taken:** Zoho Mail (free tier) is the MX and holds the real inboxes;
Resend sends transactional mail; AetherMail is a view on top over IMAP. The
point is that business mail must not depend on the laptop, on Vercel, or on
Neon — all three of which it depended on before, which is why it kept breaking.

### Done

- IMAP sync is provider-agnostic (`src/lib/imap-sync.ts`). It was hardcoded to
  `imap.gmail.com`, and the unified sync in `server.ts` gated on
  `email_address.includes('@gmail.com')` — so business mailboxes were silently
  skipped, which is the entire point of the feature.
- Certificate verification re-enabled on IMAP (`rejectUnauthorized` was `false`).
- Hardcoded credential fallbacks removed from the send path and the committed
  `api/index.js` bundle.
- Route 53 tooling written and smoke-tested: `Consolidated-Hub/scripts/dns/`.
- `tsc --noEmit` clean.

### Not done — this is the actual remaining work

1. **Apply the DNS records.** Blocked only on an AWS session.
2. **Create the Zoho account and mailboxes.** Manual; needs a human.
3. **Verify the domain in Resend** and apply its DKIM.
4. **Point `DATABASE_URL` at a Neon project with headroom.** The current one is
   over quota — that is the 500 on `/api/emails` while `/api/health` returns 200.
   Mohammed has a paid Neon account; ask him which project, do not go hunting
   for a connection string.
5. **Rotate the leaked credentials** (see the warning at the bottom).

---

## Setting up the new machine

Nothing secret is in git, by design — `.env*` is gitignored except
`.env.example`. So a fresh clone runs, but does nothing useful until the values
below exist.

```bash
git clone git@github.com:mraaziqp/Aether-Mail.git
git clone git@github.com:mraaziqp/Consolidated-Hub.git
cd Aether-Mail && npm install
cp .env.example .env     # then fill it in, see the table below
npm run lint             # should pass clean
```

Tooling the DNS scripts need: `aws` CLI, `jq`, `python3`, `dig`
(`dnsutils`). The scripts check for these and say which is missing.

Re-authenticate on the new machine:

```bash
aws login            # Route 53 — expires, expect to redo this
npx vercel login     # deploys and env vars
```

### Secrets to bring across

Values are in `~/Desktop/projects/Aether-Mail/.env` on the old laptop — copy
that file directly rather than retyping. Names and sources, for reference:

| Variable | Where it comes from | Notes |
|---|---|---|
| `DATABASE_URL` | Neon console | **Must change** — current project is over quota |
| `RESEND_API_KEY` / `SMTP_PASS` | Resend dashboard | Existing key is send-scoped only |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` | `smtp.resend.com` / `587` / `resend` | |
| `AETHERMAIL_SENDER` | `contact@arpcloudsolutions.co.za` | |
| `IMAP_HOST` … `IMAP_PASSWORD` | Zoho, once the mailbox exists | See `.env.example` |
| `GMAIL_USER` / `GMAIL_APP_PASSWORD` | Google app passwords | **Rotate — see below** |
| `BACKUPE9_USER` / `BACKUPE9_APP_PASSWORD` | Google app passwords | **Rotate.** `BACKUPE9_USER` is currently unset, so that sender fails with a clear error until added |
| `GEMINI_API_KEY` | AI Studio | Optional; without it classification degrades to keyword matching |
| `PAYFAST_*` | PayFast dashboard | Unrelated to mail |

### What does *not* come with you

These were laptop-local and will not exist on the new machine. None of them
block business mail:

- Postgres on `127.0.0.1:5433` — production uses Neon.
- Stalwart (`~/stalwart-data`, `stalwart.service`) — deliberately not migrated,
  see below.
- systemd **user** units (`aethermail.service` et al) and the Cloudflare tunnels.

---

## Do not try to self-host the mail server

It is the obvious idea and it does not work on a residential line. Measured on
the old laptop, not assumed:

```
gmail-smtp-in.l.google.com:25  FAIL (15s silent timeout)
alt1.aspmx.l.google.com:25     FAIL (15s silent timeout)
smtp.resend.com:587            OPEN (214ms)
smtp.gmail.com:465             OPEN (198ms)
```

Port 25 is blocked in both directions — that is delivery *and* receiving. The
machine sits behind NAT, and Cloudflare Tunnel carries HTTP only, so it cannot
forward SMTP or IMAP either. A residential IP is also on the Spamhaus PBL, so
anything that did escape would land in spam.

**Re-run those four checks on the new machine before concluding anything.** If
it is a different connection the answer could differ — but verify, do not hope.

Stalwart on the old laptop had been failing Let's Encrypt `tls-alpn-01` every
few hours for two days against hostnames that do not resolve, burning
rate-limited validation attempts. If it is still running there, stop it.

---

## Traps worth knowing

- **Route 53 UPSERT replaces every value at a name+type.** Writing SPF to the
  apex destroys any other apex TXT, and domain-verification strings live there.
  `apply-dns.sh` backs up the zone and refuses if it finds apex TXT it did not
  expect; `add-verification.sh` merges rather than overwrites. Do not bypass this.
- **DKIM keys exceed the 255-character TXT string limit** and must be split into
  quoted chunks or Route 53 rejects the record. The script handles it.
- **DMARC starts at `p=quarantine`, deliberately.** `p=reject` with a
  not-yet-correct SPF silently destroys real mail.
- **Zoho's MX hostnames differ by data centre** (`mx.zoho.eu` vs `mx.zoho.com`).
  Check what Zoho actually shows you against `route53-core.json` before applying.
- **`api/index.js` is a committed build artifact.** Editing `src/` alone leaves
  the old code deployed — run `npm run build:api`. This is how the hardcoded
  credentials survived earlier cleanups.
- **DNS is at Route 53, not Cloudflare**, and the apex serves from
  CloudFront/Amplify while the subdomains are on Vercel. Do not assume one provider.

---

## Security — act on this before anything else

Live credentials were committed and pushed to GitHub:

- **Two Gmail app passwords** in this repo, commit `a933276` — in `server.ts`,
  `src/app/actions/send-email.ts` and the built `api/index.js`, as
  `process.env.X || '<literal>'` fallbacks.
- **A Neon database password** in `mraaziqp/VerifiedBizLink`'s `.env.example`,
  which is a *tracked* file, plus `||` fallbacks in `scripts/*.js` there.

The working trees are clean now, but **the values remain in git history and must
be rotated at the provider** — cleaning the source is not the fix. Revoke the
Gmail app passwords at <https://myaccount.google.com/apppasswords>, reset the
Neon role password, then update `.env` and the Vercel `aethermail` project.

A literal fallback does two kinds of damage: it publishes a working credential,
and it makes a missing env var look like working configuration until the day the
real value changes. When auditing this codebase, grep source **and** committed
build output:

```bash
grep -rnE "\|\| *'(re_|npg_|AIza|[a-z]{16})" --exclude-dir=node_modules .
```
