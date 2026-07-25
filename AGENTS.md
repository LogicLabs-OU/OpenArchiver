# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository. The
fastest, most reproducible way to develop here is the **devcontainer** — it
brings up the app's backing services and a matching Node toolchain in one step.

## TL;DR

```bash
# From the host, in the repo root:
devcontainer up --workspace-folder .                 # build + start, runs post-create
devcontainer exec --workspace-folder . pnpm db:migrate
devcontainer exec --workspace-folder . pnpm dev:oss  # app + workers, hot reload
```

Frontend → http://localhost:3000 · Backend API → http://localhost:4000

## Develop in the devcontainer

The devcontainer (`.devcontainer/`) is a **Docker Compose** setup that layers a
`dev` service (Node 22 + pnpm) on top of the project's existing backing services
from the root `docker-compose.yml`, all on the `open-archiver-net` network.

- **What starts:** `dev`, `postgres`, `valkey`, `meilisearch`, `tika`.
  The production `open-archiver` container is intentionally **not** started
  (`runServices` in `devcontainer.json`) — you run the app from source inside
  `dev` instead.
- **Reachability:** because `dev` shares the network, the app reaches
  `postgres:5432`, `valkey:6379`, `meilisearch:7700`, and `tika:9998` by their
  compose service names — exactly like the production container does. These are
  the hostnames already baked into `.env`.
- **First-run setup** (`.devcontainer/post-create.sh`, runs once): activates
  pnpm `10.13.1` via corepack, seeds `.env` from `.env.example` if missing
  (an existing `.env` is left untouched), runs `pnpm install`, and builds
  `@open-archiver/types` so imports and `tsc` resolve immediately.

### Two ways to drive it

- **VS Code / Cursor:** "Reopen in Container". Ports 3000/4000 are forwarded
  automatically; Prettier + Svelte + Vitest extensions are preinstalled.
- **CLI (headless / agents):** use the `devcontainer` CLI from the host:

  ```bash
  devcontainer up --workspace-folder .                       # create/start
  devcontainer exec --workspace-folder . <cmd>               # run a command inside
  devcontainer up --workspace-folder . --remove-existing-container   # rebuild clean
  ```

  Run all `pnpm`/`node`/`tsc` commands **through `devcontainer exec`** so they
  use the container's toolchain and can reach the services — not the host.

### Devcontainer maintenance note

Relative paths in the Compose files resolve against the Compose **project
directory**, which the devcontainer CLI sets to the **repo root** (the first
`-f` file's directory), *not* the `.devcontainer/` folder. That's why the `dev`
service bind mount in `.devcontainer/docker-compose.yml` is `.:/workspaces/...`
and **not** `..:` — the latter would mount the repo's parent directory. If you
see the workspace contents look "one level too high," this is why.

## Repo layout (pnpm workspace)

| Path | What it is |
|---|---|
| `packages/backend` | API server + BullMQ workers, Drizzle ORM (Postgres), Meilisearch indexing, ingestion connectors |
| `packages/frontend` | SvelteKit UI |
| `packages/types` | Shared TypeScript types — **build this first**; backend/frontend import `@open-archiver/types` from its `dist` |
| `apps/open-archiver` | OSS app entrypoint that wires the backend together |
| `packages/enterprise` | Enterprise-only; **excluded** from OSS builds |

Toolchain is pinned: Node `>=22`, pnpm `10.13.1` (`packageManager` field).

## Common commands (run via `devcontainer exec`)

```bash
pnpm install                # install workspace deps
pnpm --filter @open-archiver/types build   # build shared types (needed before typecheck)
pnpm dev:oss                # frontend + backend + all workers, hot reload
pnpm build:oss              # full OSS production build
pnpm db:migrate             # apply DB schema (Drizzle); db:generate to create migrations
pnpm lint                   # prettier --check .   (run before committing)
pnpm format                 # prettier --write .
```

Background workers are part of the runtime (not just the API): the ingestion
worker, indexing worker, and sync scheduler. `pnpm dev:oss` starts them
(`start:workers:dev`); in production they run via `docker-start:oss`.

## Architecture notes an agent should know

- **Ingestion pipeline:** provider connectors (`packages/backend/src/services/
  ingestion-connectors/` — IMAP, Google Workspace, M365, PST, EML, Mbox) yield
  `EmailObject`s → `IngestionService.processEmail` (dedup gates, storage write,
  DB insert) → BullMQ `ingestion` queue → `indexing` queue → Meilisearch. Jobs
  are dispatched per-mailbox (`process-mailbox.processor.ts`).
- **State stores:** Postgres (archived emails/attachments metadata, Drizzle),
  object storage (raw `.eml` + attachments), Meilisearch (search index), Valkey
  (BullMQ queues + cache), Tika (text extraction for indexing).
- **Config:** all runtime config is env-driven, loaded from the repo-root `.env`
  via `dotenv` at process start. `DATABASE_URL`, `REDIS_HOST`, `MEILI_HOST`,
  `TIKA_URL` point at the compose service names.

## Conventions

- **TypeScript strict mode.** Avoid `any`; define shared shapes in
  `packages/types`.
- **Prettier** is the formatter — `pnpm lint` must pass before committing.
- **Commits:** imperative present tense ("Add batch fetch", not "Added"), first
  line ≤72 chars, reference issues/PRs after the first line. See
  `CONTRIBUTING.md`.
- **Tests:** there is currently **no test suite or runner** in this repo. If you
  add tests, `vitest` fits the TS/ESM/pnpm stack best (the Vitest VS Code
  extension is already listed in the devcontainer). Prefer unit-testing pure
  logic and connector behavior with injected/mocked clients over hitting live
  services.
