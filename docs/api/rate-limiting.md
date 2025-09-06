# Rate Limiting

The API implements rate limiting as a security measure to protect your instance from denial-of-service (DoS) and brute-force attacks. This is a crucial feature for maintaining the security and stability of the application.

## How It Works

The rate limiter restricts the number of requests an IP address can make within a specific time frame. These limits are configurable via environment variables to suit your security needs.

By default, the limits are:

- **100 requests** per **1 minute** per IP address.

If this limit is exceeded, the API will respond with an HTTP `429 Too Many Requests` status code.

### Response Body

When an IP address is rate-limited, the API will return a JSON response with the following format:

```json
{
	"status": 429,
	"message": "Too many requests from this IP, please try again after 15 minutes"
}
```

## Configuration

You can customize the rate-limiting settings by setting the following environment variables in your `.env` file:

- `RATE_LIMIT_WINDOW_MS`: The time window in milliseconds. Defaults to `60000` (1 minute).
- `RATE_LIMIT_MAX_REQUESTS`: The maximum number of requests allowed per IP address within the time window. Defaults to `100`.

## Handling Rate Limits

If you are developing a client that interacts with the API, you should handle rate limiting gracefully:

1.  **Check the Status Code**: Monitor for a `429` HTTP status code in responses.
2.  **Implement a Retry Mechanism**: When you receive a `429` response, it is best practice to wait before retrying the request. Implementing an exponential backoff strategy is recommended.
3.  **Check Headers**: The response will include the following standard headers to help you manage your request rate:
    - `RateLimit-Limit`: The maximum number of requests allowed in the current window.
    - `RateLimit-Remaining`: The number of requests you have left in the current window.
    - `RateLimit-Reset`: The time when the rate limit window will reset, in UTC epoch seconds.

## Excluded Endpoints

Certain essential endpoints are excluded from rate limiting to ensure the application's UI remains responsive. These are:

- `/auth/status`
- `/settings/system`

These endpoints can be called as needed without affecting your rate limit count.
