# Troubleshooting CORS Errors

Cross-Origin Resource Sharing (CORS) is a security feature that controls how web applications in one domain can request and interact with resources in another. If not configured correctly, you may encounter errors when performing actions like uploading files.

This guide will help you diagnose and resolve common CORS-related issues.

## Symptoms

You may be experiencing a CORS issue if you see one of the following errors in your browser's developer console or in the application's logs:

- `TypeError: fetch failed`
- `Cross-Origin Request Blocked: The Same Origin Policy disallows reading the remote resource.`
- `Unexpected token 'C', "Cross-site"... is not valid JSON`
- A JSON error response similar to the following:
    ```json
    {
    	"message": "CORS Error: This origin is not allowed.",
    	"requiredOrigin": "http://localhost:3000",
    	"receivedOrigin": "https://localhost:3000"
    }
    ```

## Root Cause

These errors typically occur when the URL you are using to access the application in your browser does not exactly match the `APP_URL` configured in your `.env` file.

This can happen for several reasons:

- You are accessing the application via a different port.
- You are using a reverse proxy that changes the protocol (e.g., from `http` to `https`).
- The SvelteKit server, in a production build, is incorrectly guessing its public-facing URL.

## Solution

The solution is to ensure that the application's frontend and backend are correctly configured with the public-facing URL of your instance. This is done by setting two environment variables: `APP_URL` and `ORIGIN`.

1.  **Open your `.env` file** in a text editor.

2.  **Set `APP_URL`**: Define the `APP_URL` variable with the exact URL you use to access the application in your browser.

    ```env
    APP_URL=http://your-domain-or-ip:3000
    ```

3.  **Set `ORIGIN`**: The SvelteKit server requires a specific `ORIGIN` variable to correctly identify itself. This should always be set to the value of your `APP_URL`.

    ```env
    ORIGIN=$APP_URL
    ```

    By using `$APP_URL`, you ensure that both variables are always in sync.

### Example Configuration

If you are running the application locally on port `3000`, your configuration should look like this:

```env
APP_URL=http://localhost:3000
ORIGIN=$APP_URL
```

If your application is behind a reverse proxy and is accessible at `https://archive.mycompany.com`, your configuration should be:

```env
APP_URL=https://archive.mycompany.com
ORIGIN=$APP_URL
```

After making these changes to your `.env` file, you must restart the application for them to take effect:

```bash
docker compose up -d --force-recreate
```

This will ensure that the backend's CORS policy and the frontend server's origin are correctly aligned, resolving the errors.
