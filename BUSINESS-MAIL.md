# Business email — what actually works from here

## The blocker

**This laptop cannot send mail directly.** Outbound port 25 is blocked on your
connection, which is normal for a residential line. Even with Stalwart running
locally, nothing would leave the machine.

Two further problems would remain even if the port were open: a residential IP
sits on blocklists like the Spamhaus PBL, so mail that did leave would land in
spam; and receiving needs inbound 25 reachable, which a home connection behind
CGNAT generally is not.

Self-hosting the delivery itself is the wrong tool for a registered business.
A business address that silently lands in spam is worse than not having one.

## What works: a relay

AetherMail now sends through **any authenticated SMTP relay** — the transport
takes credentials and keeps TLS verification on for anything not local. Pick a
provider, set four variables, and sending works.

```
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=resend
SMTP_PASS=<api key>
AETHERMAIL_SENDER=jarvis@yourbusiness.co.za
```

Then restart: `systemctl --user restart aethermail`

### Choosing one

| Need | Use |
|---|---|
| Send only (notifications, replies) | **Resend** — simplest, free tier covers a small business |
| Send only, already on AWS | **SES** — cheap at volume, needs sandbox removal first |
| Real mailboxes at your domain (send *and* receive) | **Zoho Mail** — free for one domain, or Google Workspace |

For a registered business you almost certainly want the third row. A relay sends
but gives you no inbox; Zoho or Workspace gives you real addresses, and
AetherMail then sits on top as the unified view.

## Domain records

Whichever you choose, the domain needs these. `src/lib/dkim.ts` generates the
keypair and the exact record set — it is tested and works.

| Type | Host | Purpose |
|---|---|---|
| MX | `@` | where incoming mail goes |
| TXT | `@` | SPF — who may send as you |
| TXT | `default._domainkey` | DKIM public key |
| TXT | `_dmarc` | what to do with failures |

Start DMARC at `p=quarantine`, not `p=reject`. A misconfigured SPF with reject
silently destroys real mail.

## Where Jarvis fits

Once a provider is chosen, Jarvis can send through AetherMail's `/api/v1/emails/send`
using his agent key, and read what arrives through the webhook ingress. The
triage, classification and alerting already work — verified against a real bank
alert.

He cannot "create his own mail account": mailbox creation is the provider's, and
the domain is yours. What he can do is use an address you create for him.
