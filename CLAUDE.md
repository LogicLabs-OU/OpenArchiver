# Open Archiver - Project Context

## Overview
This is a customized fork of Open Archiver, a self-hosted email archiving solution with full-text search. We are modifying the open source version to fit our specific requirements.

## Tech Stack
- **Backend**: Node.js, Express, TypeScript, Drizzle ORM
- **Frontend**: SvelteKit, Tailwind CSS
- **Database**: PostgreSQL 17
- **Search**: Meilisearch
- **Cache/Queue**: Valkey (Redis-compatible)
- **Document Processing**: Apache Tika
- **Package Manager**: pnpm 10.13.1
- **Node Version**: 22+

## Project Structure
```
apps/open-archiver/       # Main application entry point & Dockerfile
packages/
  backend/                # API, services, workers, database schema
  frontend/               # SvelteKit frontend
  types/                  # Shared TypeScript types
```

## Development & Deployment

### Build locally
```bash
pnpm install
pnpm build:oss
```

### Docker deployment (production)
```bash
# Build and start all services
sg docker -c "docker compose up -d --build"

# Rebuild only the app after code changes
sg docker -c "docker compose build --no-cache open-archiver"
sg docker -c "docker compose up -d open-archiver"
```

### Key files
- `.env` - Environment configuration (not committed)
- `docker-compose.yml` - Local Docker deployment (builds from source)
- `packages/types/src/ingestion.types.ts` - Ingestion source type definitions
- `packages/backend/src/services/ingestion-connectors/` - Email provider connectors
- `packages/frontend/src/lib/translations/en.json` - UI translations

## Custom Modifications

### Google Workspace User Filtering
Added ability to archive only specific users instead of entire domain:
- `GoogleWorkspaceCredentials.allowedUserEmails` - Optional array of emails to archive
- If empty/not set, archives all users (default behavior)
- Configure via UI in the "Allowed User Emails" field when creating/editing ingestion source

## Configuration Notes
- `ENABLE_DELETION=true` - Required to delete ingestion sources via UI
- Changes to `.env` require container recreation: `docker compose up -d` (not just restart)

## Instance
- URL: https://archive.unitedproducts.com.au
- Currently archiving: helenn@unitedproducts.com.au
