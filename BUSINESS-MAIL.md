# Business mail for arpcloudsolutions.co.za

Status as of 2026-09-29. Replaces the earlier "pick a provider" version — the
provider is now chosen (Zoho Mail, free tier) and this is the runbook.

## Why it was not working

Not a code problem. `arpcloudsolutions.co.za` had **no mail DNS at all**: no MX,
no SPF, no DKIM, no DMARC. Nothing on the internet knew where to deliver mail
for the domain, and nothing could legitimately send as it. `mail.` and
`aethermail.` had no A record either, so both Vercel subdomains were dead
while `templates.`, `builder.`, `raaziq.` and `portfolio.` worked fine.

## Why it cannot be self-hosted here

Stalwart is installed and running (`stalwart.service`, user scope,
`~/stalwart-data`). It cannot be the MX for this domain, and the reason is
measured, not assumed:

```
gmail-smtp-in.l.google.com:25  FAIL (15s silent timeout)
alt1.aspmx.l.google.com:25     FAIL (15s silent timeout)
smtp.resend.com:587            OPEN (214ms)
smtp.gmail.com:465             OPEN (198ms)
```

Port 25 is blocked by the ISP. That kills delivery **and** receiving. The
machine is behind NAT on 192.168.31.166, and Cloudflare Tunnel only carries
HTTP, so it cannot forward SMTP or IMAP either. A residential IP also sits on
the Spamhaus PBL, so anything that did escape would land in spam.

Stalwart's own log shows the consequence: it has been failing Let's Encrypt
`tls-alpn-01` every few hours for two days against `mail.`, `mta-sts.` and
`autoconfig.`, all NXDOMAIN. Once `mail.` points at Vercel it will keep
failing, for a different reason. **Disable its ACME or stop the service** — it
is burning validation attempts against a rate-limited endpoint for no benefit.

It stays useful as a local archive/dev IMAP target. It is not the MX.

## The shape that works 24/7

| Concern | Where it lives | Depends on |
|---|---|---|
| Receiving | Zoho Mail MX | Zoho only |
| Real inboxes (`contact@`, `info@`, `billing@`) | Zoho webmail + IMAP | Zoho only |
| App/transactional sending | Resend (`smtp.resend.com:587`) | Resend only |
| Unified view, triage, Jarvis | AetherMail on Vercel | Vercel + Neon |

The point of the split: business mail must not depend on the laptop, on Vercel,
or on Neon. AetherMail sits **on top** of the Zoho mailbox over IMAP. If
AetherMail is down, mail still arrives and can still be read at Zoho.

## Steps

### 1. DNS — core records

Needs an authenticated AWS session; the zone is in Route 53.

```bash
aws login
cd ~/Desktop/projects/arpcloudsolutions/Consolidated-Hub-main
./scripts/dns/apply-dns.sh            # dry run — shows current vs intended
./scripts/dns/apply-dns.sh --apply
```

Writes `mail.`/`aethermail.` A records (76.76.21.21, Vercel), Zoho MX, SPF and
DMARC. It backs up the whole zone first and refuses to run if the apex TXT
holds anything it would clobber.

DMARC starts at `p=quarantine`, deliberately. `p=reject` with a
not-yet-correct SPF silently destroys real mail.

### 2. Zoho — create the account and mailboxes

Manual; mailbox creation is the provider's, and the account has to be yours.

1. Sign up at <https://www.zoho.com/mail/> → Forever Free plan, "add existing domain".
2. Enter `arpcloudsolutions.co.za`. Zoho gives a verification value.
3. Apply it:
   ```bash
   ./scripts/dns/add-verification.sh zoho-verify-cname zbXXXXXXXX --apply
   ```
   (Use `zoho-verify-txt` if Zoho offers only the TXT method. That path merges
   with the live apex TXT so SPF survives.)
4. Create `contact@`, `info@`, `billing@`.
5. Zoho → Email Authentication → generate DKIM, then:
   ```bash
   ./scripts/dns/add-verification.sh zoho-dkim zoho "v=DKIM1; k=rsa; p=MIGf..." --apply
   ```
   The script chunks keys over 255 characters, which Route 53 rejects otherwise.

If you sign up on a regional Zoho DC the MX hostnames differ (`mx.zoho.eu` and
friends). Check what Zoho shows you against `route53-core.json` before applying.

### 3. Resend — verify the domain for app sending

The API key in `.env` is send-scoped, so domain status cannot be read from the
CLI. In the Resend dashboard, add `arpcloudsolutions.co.za`, then apply the
DKIM value it gives:

```bash
./scripts/dns/add-verification.sh resend-dkim "p=MIGf..." --apply
```

Resend uses a `send.` subdomain for its return path, so it does not fight
Zoho's MX on the apex. The apex SPF already includes `amazonses.com`.

### 4. Point AetherMail at the mailbox

In `.env` and in the Vercel `aethermail` project:

```
IMAP_HOST=imap.zoho.com
IMAP_PORT=993
IMAP_PROVIDER=zoho
IMAP_SPAM_FOLDER=Spam
IMAP_PASSWORD=<Zoho app-specific password for contact@>
AETHERMAIL_SENDER=contact@arpcloudsolutions.co.za
```

`src/lib/imap-sync.ts` resolves the server per address: Gmail, Outlook and
`zoho.com` by name, anything else via `IMAP_HOST`. An unknown domain throws
instead of quietly defaulting to Gmail — that default used to turn "this domain
is not configured" into "authentication failed".

The unified sync no longer skips non-Gmail accounts. That `@gmail.com` gate was
silently excluding the business mailboxes, which are the ones that matter.

### 5. Verify

```bash
dig +short MX arpcloudsolutions.co.za
dig +short TXT arpcloudsolutions.co.za
dig +short TXT _dmarc.arpcloudsolutions.co.za
dig +short A mail.arpcloudsolutions.co.za
```

Then send a real message from an outside address to `contact@` and confirm it
lands in Zoho. Check SPF/DKIM/DMARC all pass in the received headers before
telling anyone the address works.

## Still outstanding

- **Neon is over quota**, which is why `https://aethermail-five.vercel.app/api/emails`
  returns 500 while `/api/health` is fine. AetherMail's unified view stays broken
  until `DATABASE_URL` points at a project with headroom. Business mail does not
  depend on this.
- **Leaked credentials.** Two Gmail app passwords were committed to this repo
  (commit `a933276`) and pushed. Source is clean now, but they are in history and
  must be revoked and reissued.
