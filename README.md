# Shoop — Agentic Shopping Assistant

Shoop is a Next.js 16 app that pairs an Anthropic-powered shopping concierge
with Shopify's Unified Commerce Platform (UCP) for catalog search, cart, and
checkout. The chat agent runs on a fashion-memory pipeline that extracts
structured facts per user across conversations to personalize recommendations.

## Tech stack

- **Next.js 16** (App Router, Turbopack, RSC streaming) on Node.js 20+.
- **TypeScript 5** strict mode end-to-end.
- **Tailwind 4** for styling, **Zustand** for client state, **Zod** for
  request validation.
- **Prisma 5** against **Postgres** (Supabase Session Pooler).
- **Anthropic SDK** with Claude Sonnet 4.6 (chat) and Haiku 4.5 (memory gate).
- **Shopify UCP** for catalog search, cart, checkout, and order webhooks.

## Quick start

```bash
cp .env.example .env        # fill in secrets — see comments inline
npm install                  # runs `prisma generate` via postinstall
npx prisma db push           # provisions the schema against DATABASE_URL
npm run dev                  # starts http://localhost:3000
```

> The chat module needs `ANTHROPIC_API_KEY` and a reachable `DATABASE_URL`.
> Shopify flows additionally need `SHOPIFY_CATALOG_CLIENT_ID` /
> `SHOPIFY_CATALOG_CLIENT_SECRET`.

## Scripts

| Script              | What it does                                                  |
| ------------------- | ------------------------------------------------------------- |
| `npm run dev`       | Next.js dev server with Turbopack.                            |
| `npm run build`     | Production build (runs `next build`).                         |
| `npm run start`     | Serves the production build.                                  |
| `npm run lint`      | ESLint over the workspace.                                    |
| `npm run db:generate` | Regenerate the Prisma client after schema changes.          |
| `npm run db:push`   | Push the Prisma schema to the database (no migration files). |

## Repository layout

```
src/
  app/                 # Next.js App Router routes
    api/               # JSON / SSE API endpoints
    chat/              # Chat UI pages (server entries)
  components/          # Client-side React components
    chat/              # Conversation, composer, sidebar, etc.
    cart/              # CartDrawer + Zustand cart store
    onboarding/        # First-run onboarding flow
  lib/
    ai-chat/           # Anthropic streaming + chat plumbing
    fashion-memory/    # Fashion router, search, curation pipeline
    cart/              # Cart persistence layer
    shopify/           # UCP catalog / cart / checkout / webhook clients
    shared/, design/   # Misc shared helpers
prisma/schema.prisma   # Database schema
docs/                  # Shopify UCP tutorials + chat module reference
```

## Configuration

See `.env.example` for the full list of environment variables. The most
important ones:

- `ANTHROPIC_API_KEY` — chat and memory extraction.
- `DATABASE_URL` — Postgres / Supabase Session Pooler URL.
- `SHOPIFY_CATALOG_CLIENT_ID` / `SHOPIFY_CATALOG_CLIENT_SECRET` — Catalog MCP
  credentials. The secret doubles as the HMAC key for `/api/webhooks/orders`.
- `NEXT_PUBLIC_APP_URL` — public origin used to build the UCP agent profile
  URL. Must be HTTPS in production.
- `AI_CHAT_ADMIN_TOKEN` — optional shared secret for the admin-only
  `PATCH /api/messages/:id` direct mutation path. Leave unset to keep it
  locked.

## Operational notes

- **Logging** is structured via `logAiChat(level, event, payload)` in
  `src/lib/ai-chat/observability.ts`. Every server log line is a single JSON
  object — pipe stdout to your log aggregator and parse from there.
- **Shopify webhooks** at `/api/webhooks/orders` verify the HMAC signature
  via `verifyOrderWebhook` before doing any work. Always respond `200` within
  Shopify's 5s budget; downstream work is deferred via `queueMicrotask`.
- **Prisma pool** is capped via the `connection_limit=` query param applied
  in `src/lib/ai-chat/db.ts`. Adjust `PRISMA_CONNECTION_LIMIT` to match your
  pooler's hard cap divided by the number of Next.js workers you run.
- **Memory pipeline** runs after each assistant turn (`pipeline.ts`), gated
  by a Haiku-based classifier; deep extraction uses Sonnet 4.6.

## Deploy on Railway

This repo includes [`railway.json`](./railway.json) for zero-config deploys via
[Railpack](https://docs.railway.com/builds/railpack). The build uses Next.js
`output: "standalone"` and serves via `node .next/standalone/server.js`.

1. Create a project on [Railway](https://railway.com/new) and connect this
   GitHub repo (recommended), or deploy with the CLI: `railway up`.
   - **CLI deploys:** `.railwayignore` excludes `node_modules/` and `.next/`
     from the upload (Railway builds those remotely). Without a git repo, the
     CLI does not apply `.gitignore` on its own.
2. Generate a public domain under **Networking → Generate Domain**.
3. Set environment variables from [`.env.example`](./.env.example). At minimum:
   - `NEXT_PUBLIC_APP_URL` — your Railway HTTPS domain (set **before** the
     first build; redeploy after changes).
   - `DATABASE_URL` — Supabase Session Pooler URL (see comments in
     `.env.example`).
   - `ANTHROPIC_API_KEY`, Supabase keys, and Shopify catalog credentials.
4. Each deploy runs `npm run db:deploy` during the **build** step (not
   pre-deploy — Railway's pre-deploy window is too short for Prisma + SQL)
   to sync the schema, then starts the app. Health checks hit
   `/api/health`.

Railway sets `PORT` and `HOSTNAME` automatically; the standalone server picks
them up. Do **not** set `SHOPIFY_CHECKOUT_BUYER_IP` in production — Railway
forwards the real client IP via proxy headers.

## Known production blockers

These need to be addressed before exposing the app to real, multi-tenant
traffic:

1. **Authentication.** Every API route hard-codes
   `AI_CHAT_DEFAULT_USER_ID = "local-dev-user"`. There is no per-user auth or
   session layer, so every visitor reads / writes / checks out as the same
   single user. Wire up Supabase Auth (or your provider of choice) and
   replace `AI_CHAT_DEFAULT_USER_ID` with the authenticated user id across
   every route under `src/app/api/*` before going live.
2. **Legal copy.** The home page previously rendered placeholder "Terms /
   Privacy / Subscription" links pointing to `#`. They have been removed
   pending real URLs; re-add the component (or equivalent) with the live
   policies before launch.
3. **Profile management UI.** The `/api/profile/*` endpoints are implemented
   and validated but no front-end currently consumes them. Ship a settings
   screen before a real audit. Chat memory is fashion-memory only
   (`/api/fashion-memory/*`).
