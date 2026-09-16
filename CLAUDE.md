# AetherMail — Agent Constitution & System Rules

You are working on **AetherMail**, a unified AI-driven Network Operations Center (NOC) email and incident command console built for autonomous triage and enterprise IT operations.

## Tech Stack
- **Architecture**: Next.js App Router & Vite/Express hybrid runtime with TypeScript.
- **Database & ORM**: Neon PostgreSQL / Cloud SQL via Drizzle ORM (`drizzle-orm`, `drizzle-kit`).
- **AI Engine**: Google Gemini 2.5 Flash via `@google/genai` TypeScript SDK (server-side only).
- **Styling**: Tailwind CSS, Lucide React icons, Motion animations.
- **Local Dev OS**: Windows Subsystem for Linux (WSL2) + Docker Compose (PostgreSQL, EmailEngine).

## Essential Commands
- `npm run dev`: Boots the development server with live backend endpoints on port 3000.
- `npm run build`: Production bundle (`vite build` + `esbuild server.ts`).
- `npm run lint`: Runs TypeScript validation (`tsc --noEmit`).
- `npm run db:push`: Pushes `src/db/schema.ts` directly to Neon/PostgreSQL.
- `npm run db:generate`: Generates migration artifacts into `./drizzle`.
- `npm run db:studio`: Launches Drizzle Studio GUI for raw database inspection.

## Strict Architectural Rules
1. **Server Actions vs. Bot REST API**:
   - UI client mutations must execute via Server Actions (`src/app/actions/*`) or authenticated backend controllers.
   - External autonomous bots and CLI agents strictly interface through the `/api/v1` Root Access REST API (`/api/v1/emails`, `/api/v1/emails/send`, `/api/v1/emails/:id`, `/api/v1/keys`).
2. **Bot Authentication Guard**:
   - Every `/api/v1/*` endpoint must authenticate incoming requests with `validateApiKey()` from `src/lib/api-auth.ts` enforcing `Authorization: Bearer <token>` or `x-api-key: <token>` against the SHA-256 hashed `api_keys` table before accessing Drizzle ORM.
3. **No Unsolicited API Key Fields**:
   - Never render browser form inputs requesting Gemini API keys. All keys remain server-side in `.env`.
4. **NOC Command-Center Visual Philosophy**:
   - Always maintain the deep obsidian dark mode palette (`#090a0f`, `#11131a`, `#1a1d27`).
   - High-contrast Geist/Inter typography, 1px borders, monospace badges (`Geist Mono`).
   - High-density layouts: P0 alert tags (`URGENT`, `ACTION NEEDED`), split inspection drawer, action items checklist, and real-time sync telemetry.
