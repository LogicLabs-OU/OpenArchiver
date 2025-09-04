# API Authentication

To access protected API endpoints, you need to include a user-generated API key in the `X-API-KEY` header of your requests.

## 1. Creating an API Key

You can create, manage, and view your API keys through the application's user interface.

1.  Navigate to **Settings > API Keys** in the dashboard.
2.  Click the **"Generate API Key"** button.
3.  Provide a descriptive name for your key and select an expiration period.
4.  The new API key will be displayed. **Copy this key immediately and store it in a secure location. You will not be able to see it again.**

## 2. Making Authenticated Requests

Once you have your API key, you must include it in the `X-API-KEY` header of all subsequent requests to protected API endpoints.

**Example:**

```http
GET /api/v1/dashboard/stats
X-API-KEY: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2
```

If the API key is missing, expired, or invalid, the API will respond with a `401 Unauthorized` status code.
