---
aside: false
---

# API Authentication

The API supports two authentication methods. Use whichever fits your use case.

## Method 1: JWT (User Login)

Obtain a short-lived JWT by calling `POST /v1/auth/login` with your email and password, then pass it as a Bearer token in the `Authorization` header.

**Example:**

```http
GET /api/v1/dashboard/stats
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

## Method 2: API Key

Long-lived API keys are suited for automated scripts and integrations. Create one in **Settings > API Keys**, then pass it in the `X-API-KEY` header.

**Example:**

```http
GET /api/v1/dashboard/stats
X-API-KEY: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2
```

### Creating an API Key

1. Navigate to **Settings > API Keys** in the dashboard.
2. Click **"Generate API Key"**.
3. Provide a descriptive name and select an expiration period (max 2 years).
4. Copy the key immediately — it will not be shown again.

---

If the token or API key is missing, expired, or invalid, the API responds with `401 Unauthorized`.
