---
aside: false
---

# Settings API

Read and update system-wide configuration. The `GET` endpoint is public. The `PUT` endpoint requires `manage:settings` permission.

Both endpoints work on four fields only: `language`, `theme`, `supportEmail` and `dateFormat`. The `GET` returns exactly these, and the `PUT` accepts exactly these; any other key in the request body is ignored. Everything else kept in the settings record — the seat policy and report, and on Enterprise the license status, instance ID and security policy — is internal and never returned or written through this API.

## Get System Settings

<OAOperation operationId="getSystemSettings" />

## Update System Settings

<OAOperation operationId="updateSystemSettings" />
