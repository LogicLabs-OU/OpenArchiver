# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Open Archiver is a self-hosted email archiving platform. It ingests emails from Gmail, Microsoft 365, IMAP, PST, MBOX, and .eml sources; stores them encrypted in `.eml` format (local or S3); indexes full text via Meilisearch; and exposes a SvelteKit UI.

## Monorepo Structure

Managed with **pnpm workspaces** (`pnpm-workspace.yaml`). Two workspace roots:

- `apps/open-archiver/` — thin entry point that boots the backend (`index.ts`)
- `packages/backend/` — Express.js API, BullMQ workers, Drizzle ORM schemas, i18n
- `packages/frontend/` — SvelteKit 2 + Svelte 5 + TailwindCSS 4 UI
- `packages/types/` — shared TypeScript types (`@open-archiver/types`)

Path aliases (`@open-archiver/*`) are defined in `tsconfig.base.json`.

## Common Commands

All commands run from the repo root (`OpenArchiver/`).

### Development
```bash
pnpm dev:oss          # Run frontend + backend in parallel (OSS mode)
pnpm start:workers:dev  # Run ingestion, indexing, and sync-scheduler workers
```

### Build
```bash
pnpm build            # Build all packages and apps
```

### Database (Drizzle ORM)
```bash
pnpm db:generate      # Generate migration files from schema changes
pnpm db:migrate       # Apply pending migrations to PostgreSQL
```

### Lint / Format
```bash
pnpm lint             # Check formatting (Prettier)
pnpm format           # Auto-fix formatting
```

### Docker (production)
```bash
cp .env.example .env  # Configure environment first
docker compose up -d  # Start full stack (PostgreSQL, Valkey, Meilisearch, Tika, app)
```

## Architecture

### Request Flow
Browser → SvelteKit frontend (`packages/frontend`) → Express REST API (`packages/backend`) → PostgreSQL (metadata/auth) + Meilisearch (search) + S3/local (file storage)

### Background Workers (`packages/backend/src/workers/`)
- **ingestion.worker.ts** — pulls emails from configured sources, parses, deduplicates, encrypts, stores
- **indexing.worker.ts** — extracts text from emails/attachments (via Apache Tika), pushes to Meilisearch
- **`src/jobs/schedulers/sync-scheduler.ts`** — schedules periodic re-sync for connected mailboxes

Workers communicate via **BullMQ** queues backed by **Valkey/Redis**.

### Database
Drizzle ORM with PostgreSQL. Schema files live in `packages/backend/src/database/`. Run `pnpm db:generate` after schema changes, then `pnpm db:migrate`.

### Authentication
JWT-based sessions (`jose`). OAuth providers: Google (googleapis), Microsoft (MSAL). Admin/user roles enforced at middleware level.

### Storage
Pluggable storage layer — local filesystem or S3-compatible (AWS S3, MinIO). Configured via `.env`. All stored files are encrypted at rest; SHA hashes are recorded for integrity verification.

### Search
Meilisearch handles full-text search across email bodies and attachment content (PDF, DOCX, XLSX extracted via Apache Tika and mammoth/pdf2json/xlsx).

## Key Environment Variables

See `.env.example` for the full list. Critical ones:
- `DATABASE_URL` — PostgreSQL connection string
- `REDIS_URL` — Valkey/Redis connection
- `MEILISEARCH_URL` / `MEILISEARCH_MASTER_KEY`
- `STORAGE_BACKEND` — `local` or `s3`
- `ENCRYPTION_KEY` — at-rest encryption key
