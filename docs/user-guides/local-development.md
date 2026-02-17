# Local Development Environment Setup

This guide explains how to set up a complete local development environment for OpenArchiver, running the backend and frontend locally while using Docker only for dependencies (PostgreSQL, Redis/Valkey, Meilisearch, and Tika).

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Architecture](#architecture)
- [Setting Up Dependencies](#setting-up-dependencies)
- [Backend Setup](#backend-setup)
- [Frontend Setup](#frontend-setup)
- [Testing Email Providers](#testing-email-providers)
- [Debugging Tips](#debugging-tips)
- [Common Issues](#common-issues)

## Overview

Running OpenArchiver locally in development mode provides:
- **Fast iteration**: Hot reload for both backend and frontend
- **Easy debugging**: Direct access to application logs and debugging tools
- **Isolated dependencies**: Docker containers for databases and services
- **Flexible configuration**: Easy environment variable management

## Prerequisites

Ensure you have the following installed:

- **Node.js**: v18 or later (v20 recommended)
- **pnpm**: v8 or later (`npm install -g pnpm`)
- **Docker**: v20 or later
- **Docker Compose**: v2 or later
- **Git**: For cloning the repository

Verify installations:

```bash
node --version    # Should show v18+ or v20+
pnpm --version    # Should show v8+
docker --version  # Should show Docker version 20+
docker compose version  # Should show Docker Compose version 2+
```

## Architecture

In local development mode:

```
┌─────────────────────────────────────────────────┐
│  Your Development Machine                       │
│                                                  │
│  ┌──────────────┐         ┌──────────────┐     │
│  │   Backend    │         │   Frontend   │     │
│  │  (Node.js)   │◄────────┤   (SvelteKit)│     │
│  │  Port 4000   │         │   Port 5173  │     │
│  └──────┬───────┘         └──────────────┘     │
│         │                                        │
│         │ Connects to localhost:                │
│         │                                        │
│  ┌──────▼────────────────────────────────────┐ │
│  │      Docker Containers                    │ │
│  │  ┌─────────┐ ┌─────────┐ ┌────────────┐ │ │
│  │  │Postgres │ │ Valkey  │ │ Meilisearch│ │ │
│  │  │ :5432   │ │ :6379   │ │   :7700    │ │ │
│  │  └─────────┘ └─────────┘ └────────────┘ │ │
│  │  ┌─────────┐                             │ │
│  │  │  Tika   │                             │ │
│  │  │ :9998   │                             │ │
│  │  └─────────┘                             │ │
│  └─────────────────────────────────────────┘ │
│     ↑ All ports exposed to host             │
└─────────────────────────────────────────────────┘
```

**Key Points:**
- **Frontend at port 5173**: When running `pnpm dev`, Vite's development server runs on port 5173 with hot reload
- **Frontend at port 3000**: Only when running a production build via `pnpm build && pnpm preview` or in Docker
- **Backend at port 4000**: Configured via `PORT_BACKEND` environment variable
- **All dependency services**: Exposed to `localhost` so your local backend/frontend can connect

## Setting Up Dependencies

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/OpenArchiver.git
cd OpenArchiver
```

### 2. Install Dependencies

```bash
# Install all workspace dependencies
pnpm install
```

### 3. Start Docker Dependencies

The repository includes a `docker-compose.dev.yml` file that runs only the dependency services with all ports exposed to the host machine.

Start the dependencies:

```bash
docker compose -f docker-compose.dev.yml up -d
```

Verify all services are healthy:

```bash
docker compose -f docker-compose.dev.yml ps
```

All services should show status "healthy" after a few moments.

**Service Endpoints:**
- PostgreSQL: `localhost:5432`
- Valkey (Redis): `localhost:6379`
- Meilisearch: `localhost:7700` (also has a web UI at http://localhost:7700)
- Tika: `localhost:9998`

**Stopping Services:**

```bash
docker compose -f docker-compose.dev.yml down
```

**Removing Data (reset everything):**

```bash
docker compose -f docker-compose.dev.yml down -v
```

## Backend Setup

### 1. Configure Environment Variables

Create a `.env` file in the `packages/backend` directory or the project root (depending on your setup):

```bash
# Copy example env file
cp .env.example .env
```

Edit `.env` with the following values:

```bash
# Node Environment
NODE_ENV=development

# Backend Port
PORT_BACKEND=4000

# Database (match docker-compose.dev.yml defaults)
DATABASE_URL=postgresql://admin:password@localhost:5432/open_archive

# Redis/Valkey (match docker-compose.dev.yml defaults)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=defaultredispassword
REDIS_TLS_ENABLED=false

# Meilisearch (match docker-compose.dev.yml defaults)
MEILI_HOST=http://localhost:7700
MEILI_MASTER_KEY=aSampleMasterKey

# Tika
TIKA_URL=http://localhost:9998

# Storage (local filesystem for development)
STORAGE_TYPE=local
STORAGE_LOCAL_ROOT_PATH=./storage

# Encryption Key (generate a secure random string)
# Generate with: openssl rand -hex 32
ENCRYPTION_KEY=your-generated-encryption-key-here

# JWT Secret (generate a secure random string)
# Generate with: openssl rand -base64 32
JWT_SECRET=your-generated-jwt-secret-here

# Sync frequency (cron expression, default: every minute)
SYNC_FREQUENCY=* * * * *

# Feature flags
ENABLE_DELETION=true
ALL_INCLUSIVE_ARCHIVE=false

# Outlook Personal OAuth Configuration (for testing)
# Leave empty if not testing this feature yet
OUTLOOK_PERSONAL_CLIENT_ID=
OUTLOOK_PERSONAL_CLIENT_SECRET=
OUTLOOK_PERSONAL_REDIRECT_URI=http://localhost:5173/dashboard/ingestions/oauth-callback
```

**Important**: Generate secure values for `ENCRYPTION_KEY` and `JWT_SECRET`:

```bash
# Generate encryption key
openssl rand -base64 32

# Generate JWT secret
openssl rand -base64 32
```

### 2. Initialize Database

Run database migrations:

```bash
# Navigate to backend directory
cd packages/backend

# Run migrations using Drizzle
pnpm db:push

# or if migrations exist:
pnpm db:migrate
```

### 3. Start Backend Development Server

```bash
# From the backend directory
pnpm dev

# Or from the project root
pnpm --filter @open-archiver/backend dev
```

The backend should start on `http://localhost:4000`.

Verify it's running:

```bash
curl http://localhost:4000/health
# Should return: {"status":"ok"}
```

## Frontend Setup

### 1. Configure Frontend Environment

Create a `.env` file in `packages/frontend`:

```bash
# API Base URL
PUBLIC_API_URL=http://localhost:4000

# Public app URL
PUBLIC_APP_URL=http://localhost:5173
```

### 2. Start Frontend Development Server

```bash
# From the frontend directory
cd packages/frontend
pnpm dev

# Or from the project root
pnpm --filter @open-archiver/frontend dev
```

The frontend should start on `http://localhost:5173`.

Open your browser and navigate to `http://localhost:5173`.

**Note on Frontend Ports:**
- **Development mode (`pnpm dev`)**: Runs on port 5173 (Vite's default dev server)
- **Production mode**: When built with `pnpm build && pnpm preview`, runs on port 3000
- **Docker deployment**: The containerized app runs on port 3000

For local development and testing OAuth flows, always use `http://localhost:5173`.

## Testing Email Providers

### Testing Outlook Personal Provider

To test the Outlook Personal provider locally, you need to create a Microsoft test tenant and app registration.

#### Option 1: Using Your Personal Microsoft Account

If you have a personal Microsoft account (Outlook.com, Hotmail, etc.), you can use it directly:

1. Follow the [Outlook Personal setup guide](./email-providers/outlook-personal.md) to create an Azure app registration
2. Configure the redirect URI as: `http://localhost:5173/dashboard/ingestions/oauth-callback`
3. Add the credentials to your `.env` file
4. Create an ingestion source in the UI and follow the OAuth flow

#### Option 2: Creating a Microsoft 365 Developer Account

For testing with sample data:

1. **Join Microsoft 365 Developer Program**:
   - Visit: https://developer.microsoft.com/microsoft-365/dev-program
   - Sign up for a free developer subscription
   - You'll receive a tenant with sample users and data

2. **Create an App Registration**:
   - Follow the steps in the [Outlook Personal guide](./email-providers/outlook-personal.md)
   - Use `http://localhost:5173/dashboard/ingestions/oauth-callback` as the redirect URI

3. **Set Up Test Data**:
   - Your M365 developer tenant comes with sample users
   - You can send test emails between these users
   - Or use the Microsoft Graph Data Connect to generate sample emails

#### Seeding Test Mailbox Data

To populate a test mailbox with sample emails:

**Method 1: Manual Emails**

Send test emails to your account from various sources:

```bash
# Using curl to send via Microsoft Graph (requires access token)
curl -X POST https://graph.microsoft.com/v1.0/me/sendMail \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": {
      "subject": "Test Email",
      "body": {
        "contentType": "Text",
        "content": "This is a test email for OpenArchiver."
      },
      "toRecipients": [
        {
          "emailAddress": {
            "address": "your-test-account@outlook.com"
          }
        }
      ]
    }
  }'
```

**Method 2: Import Sample Data**

Use the EML import feature to import sample email files:

1. Download sample EML files from: https://github.com/jstedfast/MimeKit/tree/master/UnitTests/TestData/messages
2. Create a ZIP file with these EML files
3. Use the EML import provider in OpenArchiver
4. Upload the ZIP file

**Method 3: Forward Existing Emails**

Forward emails from your existing accounts to your test account to quickly populate it with realistic data.

### Testing Other Providers

#### Google Workspace

1. Create a Google Cloud project
2. Enable Gmail API
3. Create a service account
4. Enable domain-wide delegation
5. Follow the [Google Workspace guide](./email-providers/google-workspace.md)

#### Microsoft 365 (Organizational)

1. Requires an Azure AD tenant with Global Administrator access
2. Create an app registration with application permissions
3. Follow the [Microsoft 365 guide](./email-providers/microsoft-365.md)

#### Generic IMAP

Use a local IMAP server for testing:

```bash
# Start a local Dovecot IMAP server
docker run -d \
  --name test-imap \
  -p 143:143 \
  -e MAIL_ADDRESS=test@example.com \
  -e MAIL_PASS=password \
  dovecot/dovecot
```

Connect OpenArchiver using:
- Host: `localhost`
- Port: `143`
- Username: `test@example.com`
- Password: `password`
- Secure: `false`

## Debugging Tips

### Backend Debugging

#### Using VS Code Debugger

Create `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Backend",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["--filter", "@open-archiver/backend", "dev"],
      "skipFiles": ["<node_internals>/**"],
      "env": {
        "NODE_ENV": "development"
      }
    }
  ]
}
```

Set breakpoints and press F5 to start debugging.

#### Logging

Increase log verbosity by setting in `.env`:

```bash
LOG_LEVEL=debug
```

#### BullMQ Job Monitoring

Access BullMQ Board for job queue visualization:

```bash
# Install bull-board globally (optional)
npm install -g @bull-board/cli

# Start bull-board
npx bull-board
```

### Frontend Debugging

Use browser DevTools:
- Network tab: Monitor API requests
- Console tab: View application logs
- Vue/Svelte DevTools: Inspect component state

### Database Debugging

Connect to PostgreSQL:

```bash
# Using psql via Docker
docker exec -it openarchiver-postgres-dev psql -U admin -d open_archive

# Or directly from host (if psql is installed)
psql "postgresql://admin:password@localhost:5432/open_archive"

# List tables
\dt

# Query ingestion sources
SELECT id, name, provider, status FROM ingestion_sources;
```

### Meilisearch Debugging

Access Meilisearch dashboard:

```bash
# Open in browser
open http://localhost:7700

# API Key: aSampleMasterKey (from docker-compose.dev.yml)
```

Test connection:

```bash
curl http://localhost:7700/health
# Should return: {"status":"available"}
```

## Common Issues

### Port Already in Use

If you get "port already in use" errors:

```bash
# Find process using port 4000 (backend)
lsof -i :4000
kill -9 <PID>

# Find process using port 5173 (frontend)
lsof -i :5173
kill -9 <PID>
```

### Database Connection Errors

Verify PostgreSQL is running:

```bash
docker compose -f docker-compose.dev.yml ps postgres
docker logs openarchiver-postgres-dev
```

Test connection:

```bash
psql "postgresql://admin:password@localhost:5432/open_archive"
```

### Meilisearch Connection Errors

Verify Meilisearch is running and the master key is correct:

```bash
curl http://localhost:7700/health
```

### OAuth Redirect Issues

Ensure the redirect URI in Azure exactly matches your local URL:
- Protocol: `http` (not https for local dev)
- Domain: `localhost`
- Port: `5173` (Vite dev server port, NOT 3000 which is for Docker/production)
- Path: `/dashboard/ingestions/oauth-callback`

**Correct URLs for different environments:**
- Local development: `http://localhost:5173/dashboard/ingestions/oauth-callback`
- Docker/Production: `https://your-domain.com/dashboard/ingestions/oauth-callback` (or port 3000 for local Docker)

**Common mistake**: Using port 3000 for local development. Port 3000 is only used when running the full app in Docker, not when running `pnpm dev` locally.

### CORS Errors

If you encounter CORS errors, ensure your backend CORS configuration allows `http://localhost:5173`:

```typescript
// In backend/src/index.ts
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
```

## Best Practices

1. **Use pnpm workspaces**: Run commands from the root when possible
2. **Keep dependencies updated**: Regularly run `pnpm update`
3. **Use environment-specific configs**: Separate `.env` files for dev, test, prod
4. **Clean Docker volumes occasionally**: `docker compose -f docker-compose.dev.yml down -v`
5. **Monitor logs**: Keep terminal windows open for backend and frontend logs
6. **Use a reverse proxy**: For complex OAuth flows, consider using ngrok or similar

## Next Steps

- [Outlook Personal Provider Guide](./email-providers/outlook-personal.md)
- [Google Workspace Provider Guide](./email-providers/google-workspace.md)
- [Microsoft 365 Provider Guide](./email-providers/microsoft-365.md)
- [API Documentation](../api/index.md)

## Getting Help

If you encounter issues:
1. Check the logs (backend, frontend, Docker containers)
2. Search existing GitHub issues
3. Create a new issue with detailed logs and steps to reproduce
4. Join the community Discord/Slack for real-time help
