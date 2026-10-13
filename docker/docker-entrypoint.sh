#!/bin/sh

# Exit immediately if a command exits with a non-zero status
set -e

# Dependencies are part of the image: the Dockerfile installs the production node_modules in a
# stage of its own, on the target platform, and copies them in. Nothing is fetched from the npm
# registry when a container starts.

# Run database migrations before starting the application to prevent
# race conditions where the app starts before the database is ready.
pnpm db:migrate

# Execute the main container command
exec "$@"
