# Agent Guidelines for OpenArchiver

## Build & Test Commands
- **Build**: `pnpm build` (all packages), `pnpm build:oss` (OSS only)
- **Dev**: `pnpm dev:oss` (runs backend + frontend in parallel)
- **Lint**: `pnpm lint` (Prettier check), `pnpm format` (Prettier write)
- **Type Check**: `pnpm --filter @open-archiver/frontend check` (frontend only, no backend typecheck script)
- **Database**: `pnpm db:migrate` (production), `pnpm db:migrate:dev` (development)
- **Workers**: `pnpm start:workers:dev` (runs ingestion/indexing workers + scheduler)

## Code Style
- **Formatting**: Tabs (width 4), single quotes, semicolons, 100 char line width (see `.prettierrc`)
- **TypeScript**: Strict mode enabled, use `type` for type imports (`import type { ... }`)
- **Imports**: Absolute paths via `@open-archiver/backend/*`, `@open-archiver/types`, `@open-archiver/frontend/*`
- **Naming**: camelCase for variables/functions, PascalCase for classes/types/interfaces, kebab-case for files
- **Private fields**: Use `#` prefix for private class fields (e.g., `#authService`)
- **Error handling**: Use try-catch, return appropriate HTTP status codes with i18n messages (`req.t('key')`)
- **Services**: Inject dependencies via constructor, follow existing service patterns in `packages/backend/src/services/`
- **Controllers**: Methods are arrow functions for proper `this` binding
- **Database**: Use Drizzle ORM with schema in `packages/backend/src/database/schema/`
- **Frontend**: SvelteKit 5 with `$props()`, `$derived()` runes; Tailwind CSS; components in `$lib/components/`
- **No comments**: Do not add code comments unless explicitly requested
