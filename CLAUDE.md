# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

MC Bug Report — a bug tracking service for a Minecraft server. Moderators submit bugs via a Telegram bot; developers manage tickets via a React web panel. The backend is a single Fastify process that runs both the REST API and the Telegram bot, and serves the compiled React SPA.

## Development Commands

```bash
# Install all dependencies (run from root, then web/)
npm install
cd web && npm install && cd ..

# Apply DB migrations
npx prisma migrate dev

# Generate Prisma client after schema changes
npx prisma generate

# Run backend (API + Telegram bot) in watch mode
npm run dev

# Run frontend dev server (separate terminal)
cd web && npm run dev

# Build everything for production
npm run build

# Create first admin user
npx tsx scripts/create-user.ts <username>

# Reset a user's password
npx tsx scripts/create-user.ts <username> --reset
```

**Dev URLs:** Frontend at `http://localhost:5173`, API at `http://localhost:3000`

**Required env vars:** `DATABASE_URL`, `JWT_SECRET`, `BOT_TOKEN`. Optionally `ADMIN_USERNAME` + `ADMIN_PASSWORD` to auto-upsert the admin on startup.

## Architecture

### Backend (`src/`)

- **`src/index.ts`** — Entry point. Registers Fastify plugins (JWT via httpOnly cookie, static files), mounts API routes, serves the React SPA from `web/dist/`, and calls `startBot()`. Also starts the weekly cleanup job.
- **`src/db.ts`** — Singleton Prisma client.
- **`src/embeddings.ts`** — Lazy-loads `Xenova/multilingual-e5-small` (runs in-process via `@xenova/transformers`) for vector embeddings. Used for semantic duplicate detection. Embeddings are stored in the `Ticket.embedding` column as a pgvector `vector(384)`.
- **`src/cleanup.ts`** — Deletes photos from RESOLVED/DUPLICATE tickets older than 30 days. Runs on startup and every 7 days.
- **`src/bot/`** — Telegraf bot. `index.ts` wires up commands to handlers in `handlers/` (`report.ts`, `bump.ts`, `password.ts`, `admin.ts`). `botInstance.ts` is a singleton getter/setter for the Telegraf instance (used to send notifications from API routes). `categorize.ts` does keyword-based auto-categorization (bilingual RU/EN). `digest.ts` handles periodic summaries.
- **`src/api/routes/`** — Fastify route modules: `auth.ts`, `tickets.ts`, `users.ts`, `moderators.ts`. Auth uses JWT stored in a cookie. `tickets.ts` also handles photo uploads (stored in `uploads/` volume).
- **`src/api/middleware/`** — Auth middleware for protecting routes.

### Frontend (`web/src/`)

React SPA (React Router v6, no UI library — plain CSS). Pages: `Login.tsx`, `Tickets.tsx`, `Statistics.tsx`, `Moderators.tsx` (admin-only). The `Moderators` page is only accessible to users with `role: ADMIN`.

### Database (Prisma + PostgreSQL + pgvector)

Five models:
- `Ticket` — core entity. Fields: `title`, `description`, `crashReport`, `resolveComment`, `status` (OPEN/IN_PROGRESS/DUPLICATE/RESOLVED), `category` (CRASH/LAG/VISUAL/GAMEPLAY/OTHER/SUGGESTION), `urgency` (NORMAL/HIGH/CRITICAL), `bumpCount`, `tag` (unique human-readable slug), `tagNumber`, `embedding`, `photosDeleted`.
- `TicketPhoto` — uploaded images attached to a ticket; `filename` is the stored file in the `uploads/` volume.
- `TicketComment` — comments left by web panel users on tickets.
- `User` — web panel accounts, ADMIN or MODERATOR role.
- `Moderator` — Telegram users allowed to use the bot, identified by `telegramId`.

The PostgreSQL image must have the `pgvector` extension. Docker Compose uses `pgvector/pgvector:pg16` and mounts `init.sql` (runs `CREATE EXTENSION IF NOT EXISTS vector`) on first start.

### Production

Docker Compose runs PostgreSQL and the Node app. The app serves the pre-built React SPA as static files.
