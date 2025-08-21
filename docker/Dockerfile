# Dockerfile for Open Archiver

ARG BASE_IMAGE=node:22-alpine

# 0. Base Stage: Define all common dependencies and setup
FROM ${BASE_IMAGE} AS base
WORKDIR /app

# Install pnpm
RUN --mount=type=cache,target=/root/.npm \
    npm install -g pnpm

# Copy manifests and lockfile
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/backend/package.json ./packages/backend/
COPY packages/frontend/package.json ./packages/frontend/
COPY packages/types/package.json ./packages/types/

# 1. Build Stage: Install all dependencies and build the project
FROM base AS build
COPY packages/frontend/svelte.config.js ./packages/frontend/

# Install all dependencies. Use --shamefully-hoist to create a flat node_modules structure
ENV PNPM_HOME="/pnpm"
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --shamefully-hoist --frozen-lockfile --prod=false

# Copy the rest of the source code
COPY . .

# Build all packages.
RUN pnpm build

# 2. Production Stage: Install only production dependencies and copy built artifacts
FROM base AS production


# Copy built application from build stage
COPY --from=build /app/packages/backend/dist ./packages/backend/dist
COPY --from=build /app/packages/frontend/build ./packages/frontend/build
COPY --from=build /app/packages/types/dist ./packages/types/dist
COPY --from=build /app/packages/backend/drizzle.config.ts ./packages/backend/drizzle.config.ts
COPY --from=build /app/packages/backend/src/database/migrations ./packages/backend/src/database/migrations

# Copy the entrypoint script and make it executable
COPY docker/docker-entrypoint.sh /usr/local/bin/

# Expose the port the app runs on
EXPOSE 4000
EXPOSE 3000

# Set the entrypoint
ENTRYPOINT ["docker-entrypoint.sh"]

# Start the application
CMD ["pnpm", "docker-start"]
