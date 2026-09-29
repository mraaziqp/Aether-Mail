# AetherMail

A unified mail console for business and personal mailboxes: live sync from any
IMAP server, sending through Resend, AI triage, and a bot/agent REST API.

**Setting up business mail for arpcloudsolutions.co.za? Start with
[BUSINESS-MAIL.md](./BUSINESS-MAIL.md).** Deployment is in [DEPLOY.md](./DEPLOY.md).

## Key capabilities

- **Live, incremental sync** of any IMAP mailbox (Zoho, Gmail, Microsoft 365, …):
  Inbox, Spam and Sent, IDLE push on a long-running server, a 5-minute scheduler
  on Vercel, per-mailbox health telemetry.
- **Reliable sending**: Resend API first, then the mailbox's own SMTP, a relay,
  and Gmail — with threading headers and an honest report of which route worked.
- **Secure by default**: signed HttpOnly sessions, encrypted stored mailbox
  passwords, no credential fallbacks in code.
- **AI triage** (Gemini, optional): categories, one-line summaries, smart reply,
  natural-language search.
- **Bot API** (`/api/v1`): scoped, SHA-256-hashed API keys for agents.

## Local development

```bash
npm install
cp .env.example .env     # set DATABASE_URL, ADMIN_PASSWORD, APP_SECRET at minimum
docker compose up -d postgres
npm run dev              # http://localhost:3007
```

The database schema is created automatically. `npm run db:push` and
`npm run db:studio` still work for inspection.

## Keyboard shortcuts

`j`/`k` next/previous · `r` reply · `c` compose · `u` read/unread ·
`#` delete · `/` search · `Shift+R` sync now · `Esc` clear

*Bot & Agent API (v1)** in the sidebar).
2. Open the **API Key Management** tab.
3. Enter a descriptive service name (e.g. `k8s-remediation-bot`, `pagerduty-worker`).
4. Select the granted scopes (`read`, `write`, `send`, `admin`).
5. Click **Generate Scoped Bot Key**.
6. **Copy the revealed raw token** immediately (e.g. `ops_d1f8...`). It is displayed only once and hashed with SHA-256 in PostgreSQL.

---

## Bot REST API Reference (`/api/v1`)

All bot requests authenticate via:
```http
Authorization: Bearer ops_YOUR_RAW_KEY
```
or
```http
x-api-key: ops_YOUR_RAW_KEY
```

### 1. Deep Email & Incident Query
```bash
curl -s -X GET "http://localhost:3000/api/v1/emails?requires_alert=true&limit=10" \
  -H "Authorization: Bearer ops_YOUR_KEY"
```

### 2. Outbound Dispatch via Sync Engine
```bash
curl -s -X POST "http://localhost:3000/api/v1/emails/send" \
  -H "Authorization: Bearer ops_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "devops@company.com",
    "subject": "[RESOLVED] Ingress Gateway Memory Recovered",
    "htmlBody": "<p>Automated remediation agent drained failing pods.</p>"
  }'
```

### 3. Programmatic Incident Triage
```bash
curl -s -X PATCH "http://localhost:3000/api/v1/emails/msg_ops_12345" \
  -H "Authorization: Bearer ops_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "is_read": true,
    "category": "automated",
    "requires_alert": false
  }'
```

---

## Project Structure
```text
├── CLAUDE.md                 # Agent Constitution for Claude Code
├── docker-compose.yml        # Local PostgreSQL, Redis, and EmailEngine containers
├── drizzle.config.ts         # Drizzle ORM CLI configuration
├── server.ts                 # Production Express/Vite server runtime
├── src/
│   ├── app/                  # Next.js Server Actions and webhook handlers
│   ├── components/           # NOC Command Center UI components
│   │   ├── DashboardHeader.tsx
│   │   ├── DeveloperConsole.tsx
│   │   ├── EmailDetail.tsx
│   │   ├── EmailList.tsx
│   │   └── Sidebar.tsx
│   ├── db/                   # Drizzle ORM schema and PostgreSQL pool
│   │   ├── index.ts
│   │   └── schema.ts
│   ├── lib/                  # Authentication, Gemini AI client, ntfy push
│   └── types.ts              # Global TypeScript interfaces
```
