#!/usr/bin/env bash
# Runs once after the dev container is created (see devcontainer.json).
set -euo pipefail

# The pnpm store is a named volume; Docker mounts it root-owned. Hand it to the
# `node` user so pnpm can write to it. (The MS devcontainer image grants node
# passwordless sudo.)
sudo chown -R node:node /home/node/.local/share/pnpm 2>/dev/null || true

# Activate the exact pnpm pinned by package.json's packageManager field.
sudo corepack enable
corepack prepare pnpm@10.13.1 --activate

# Seed a working .env on fresh clones. An existing .env (e.g. yours) is left
# untouched.
if [ ! -f .env ]; then
	cp .env.example .env
	echo "Created .env from .env.example — review secrets before running."
fi

# Install workspace dependencies, then build the shared types package so that
# backend/frontend imports of @open-archiver/types (and tsc / vitest) resolve
# immediately without a full app build.
pnpm install
pnpm --filter @open-archiver/types build

cat <<'EOF'

Dev container ready. Backing services (postgres, valkey, meilisearch, tika) are
already running on open-archiver-net. Common next steps:

  pnpm db:migrate     # apply the database schema
  pnpm dev:oss        # frontend + backend + workers, with hot reload
  pnpm build:oss      # full production build
  pnpm lint           # prettier --check

EOF
