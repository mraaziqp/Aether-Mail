# AetherMail — AI Unified NOC Inbox & Autonomous Bot Command Center

AetherMail is an enterprise-grade Network Operations Center (NOC) email client and incident triage platform. Tailored for infrastructure engineers, DevOps teams, and autonomous AI agents, it unifies multi-account streams with sub-second Gemini 2.5 Flash threat classification, instant P0 alert dispatch via `ntfy.sh`, and root programmatic REST access for autonomous bots.

---

## Key Capabilities

- **Obsidian Dark NOC Command Center**: High-density interface (`#090a0f`) with Geist/Inter typography, monospace latency gauges, and instant category triage (`urgent`, `action_needed`, `financial`, `security`).
- **Inspection Drawer**: Split-pane view providing raw email rendering alongside Gemini metadata, threat urgency index (0–100), automated checklist extraction, and 1-click smart reply dispatch.
- **Root Access Bot Engine (`/api/v1`)**: Secure REST API enabling autonomous agents (CLI bots, PagerDuty triage bots, CI/CD workers) to query incidents, triage message threads, and dispatch outbound emails.
- **Cryptographic Bot Key Management**: SHA-256 hashed API keys with `ops_...` prefix, granular scope enforcement (`read`, `write`, `send`, `admin`), one-time secret reveals, and instant revocation.
- **Real-time Ingestion Gateway**: Webhook receiver (`/api/webhooks/email`) with pre-configured IT incident presets (Kubernetes OOMKills, SSH brute-force attacks, cloud billing alarms).

---

## Local Setup & Development (WSL2 + Docker)

### 1. Prerequisites
- **Windows 11 / WSL2 (Ubuntu 22.04+)** or macOS / Linux.
- **Docker Desktop** (with WSL2 integration enabled).
- **Node.js 20+** and **npm**.

### 2. Clone and Install Dependencies
```bash
git clone <your-repo-url> aethermail
cd aethermail
npm install
```

### 3. Spin Up Local Services (Postgres, Redis, EmailEngine)
A complete `docker-compose.yml` is provided at the root for running local PostgreSQL and EmailEngine:
```bash
docker compose up -d
```
This boots:
- **PostgreSQL 16** on `localhost:5432` (`postgres:postgrespassword`).
- **Redis 7** on `localhost:6379`.
- **EmailEngine** on `localhost:3001` (webhooks routed to `http://host.docker.internal:3000/api/webhooks/email`).

### 4. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Fill in your configuration:
```env
DATABASE_URL="postgresql://postgres:postgrespassword@localhost:5432/aethermail?sslmode=disable"
GEMINI_API_KEY="AIzaSyYourGeminiApiKeyHere"
APP_URL="http://localhost:3000"
NTFY_TOPIC="aethermail-noc-alerts"
EMAIL_SYNC_API_URL="http://localhost:3001/v1/messages/send"
```

### 5. Push Database Schema
Push the Drizzle ORM schema (`src/db/schema.ts`) to your PostgreSQL instance:
```bash
npm run db:push
```
To visually inspect tables via Drizzle Studio:
```bash
npm run db:studio
```

### 6. Start Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Generating Root Bot Keys from Developer Console

1. Navigate to the top header and click **Developer & Agents** (or select **Bot & Agent API (v1)** in the sidebar).
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
