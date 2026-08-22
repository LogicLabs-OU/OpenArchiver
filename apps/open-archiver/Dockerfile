# Dockerfile for the OSS version of Open Archiver

ARG BASE_IMAGE=node:22-alpine

# 0. Base Stage: Define all common dependencies and setup
FROM ${BASE_IMAGE} AS base
WORKDIR /app

# Copy manifests and lockfile
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/backend/package.json ./packages/backend/
COPY packages/frontend/package.json ./packages/frontend/
COPY packages/types/package.json ./packages/types/
COPY apps/open-archiver/package.json ./apps/open-archiver/

# Install the exact pnpm the repo pins. Unversioned, this installed whatever npm called latest, and
# pnpm 11 answers the packageManager field by fetching @pnpm/exe to switch itself back down to
# 10.13.1 — a download its own integrity check then refuses, because pnpm-lock.yaml has no entry for
# it. Installing the pinned version outright leaves nothing to switch to. Read from packageManager so
# the version lives in one place rather than two.
RUN --mount=type=cache,target=/root/.npm \
    npm install -g "pnpm@$(node -p 'require("/app/package.json").packageManager.split("@")[1]')"

# 1. Build Stage: Install all dependencies and build the project
FROM base AS build
COPY packages/frontend/svelte.config.js ./packages/frontend/

# Install all dependencies.
ENV PNPM_HOME="/pnpm"
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --shamefully-hoist --frozen-lockfile --prod=false

# Copy the rest of the source code
COPY . .

# Build the OSS packages.
RUN pnpm build:oss

# 2. Production Stage: Install only production dependencies and copy built artifacts
FROM base AS production

# Copy built application from build stage
COPY --from=build /app/packages/backend/dist ./packages/backend/dist
COPY --from=build /app/packages/backend/drizzle.config.ts ./packages/backend/drizzle.config.ts
COPY --from=build /app/packages/backend/src/database/migrations ./packages/backend/src/database/migrations
COPY --from=build /app/packages/frontend/build ./packages/frontend/build
COPY --from=build /app/packages/types/dist ./packages/types/dist
COPY --from=build /app/apps/open-archiver/dist ./apps/open-archiver/dist

# Copy the entrypoint script and make it executable
COPY docker/docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Create non-root user with high UID for security (prevents host UID collisions)
RUN addgroup -g 10001 -S app && \
    adduser -u 10001 -S app -G app

# Change ownership of application files to non-root user
RUN chown -R app:app /app

# Create pnpm cache directory with correct permissions
RUN mkdir -p /pnpm && chown -R app:app /pnpm

# Switch to non-root user
USER app

# Expose the port the app runs on
EXPOSE 4000
EXPOSE 3000

# Set the entrypoint
ENTRYPOINT ["docker-entrypoint.sh"]

# Start the application
CMD ["pnpm", "docker-start:oss"]
