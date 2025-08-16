#!/bin/sh

# Exit immediately if a command exits with a non-zero status
set -e

# Run pnpm install to ensure all dependencies, including native addons,
# are built for the container's architecture. This is crucial for
# multi-platform Docker images, as it prevents "exec format error"
# when running on a different architecture than the one used for building.
pnpm install --frozen-lockfile --prod

# Run database migrations before starting the application to prevent
# race conditions where the app starts before the database is ready.
pnpm db:migrate

# Execute the main container command
exec "$@"
