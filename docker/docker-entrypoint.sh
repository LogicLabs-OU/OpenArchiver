#!/bin/sh

# Exit immediately if a command exits with a non-zero status
set -e

# Only run pnpm install if node_modules doesn't exist or if lockfile changed
# This prevents unnecessary network calls on container restart
if [ ! -d "node_modules" ] || [ "pnpm-lock.yaml" -nt "node_modules" ]; then
    echo "Installing dependencies..."
    pnpm install --frozen-lockfile --prod
else
    echo "Dependencies already installed, skipping..."
fi

# Run database migrations before starting the application to prevent
# race conditions where the app starts before the database is ready.
pnpm db:migrate

# Execute the main container command
exec "$@"
