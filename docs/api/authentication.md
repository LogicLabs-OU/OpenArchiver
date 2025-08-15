# API Authentication

To access protected API endpoints, you need to include a JSON Web Token (JWT) in the `Authorization` header of your requests.

## Obtaining a JWT

First, you need to authenticate with the `/api/v1/auth/login` endpoint by providing your email and password. If the credentials are correct, the API will return an `accessToken`.

**Request:**

```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "your-password"
}
```

**Successful Response:**

```json
{
	"accessToken": "your.jwt.token",
	"user": {
		"id": "user-id",
		"email": "user@example.com",
		"role": "user"
	}
}
```

## Making Authenticated Requests

Once you have the `accessToken`, you must include it in the `Authorization` header of all subsequent requests to protected endpoints, using the `Bearer` scheme.

**Example:**

```http
GET /api/v1/dashboard/stats
Authorization: Bearer your.jwt.token
```

If the token is missing, expired, or invalid, the API will respond with a `401 Unauthorized` status code.

## Using a Super API Key

Alternatively, for server-to-server communication or scripts, you can use a super API key. This key provides unrestricted access to the API and should be kept secret.

You can set the `SUPER_API_KEY` in your `.env` file.

To authenticate using the super API key, include it in the `Authorization` header as a Bearer token.

**Example:**

```http
GET /api/v1/dashboard/stats
Authorization: Bearer your-super-secret-api-key
```
