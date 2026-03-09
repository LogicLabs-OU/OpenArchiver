# Retention Policy: API Endpoints

The retention policy feature exposes a RESTful API for managing retention policies and simulating policy evaluation against email metadata. All endpoints require authentication and the `manage:all` permission.

**Base URL:** `/api/v1/enterprise/retention-policy`

All endpoints also require the `RETENTION_POLICY` feature to be enabled in the enterprise license.

---

## List All Policies

Retrieves all retention policies, ordered by priority ascending.

- **Endpoint:** `GET /policies`
- **Method:** `GET`
- **Authentication:** Required
- **Permission:** `manage:all`

### Response Body

```json
[
    {
        "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "name": "Default 7-Year Retention",
        "description": "Retain all emails for 7 years per regulatory requirements.",
        "priority": 1,
        "conditions": null,
        "ingestionScope": null,
        "retentionPeriodDays": 2555,
        "isActive": true,
        "createdAt": "2025-10-01T00:00:00.000Z",
        "updatedAt": "2025-10-01T00:00:00.000Z"
    }
]
```

---

## Get Policy by ID

Retrieves a single retention policy by its UUID.

- **Endpoint:** `GET /policies/:id`
- **Method:** `GET`
- **Authentication:** Required
- **Permission:** `manage:all`

### Path Parameters

| Parameter | Type   | Description                    |
| --------- | ------ | ------------------------------ |
| `id`      | `uuid` | The UUID of the policy to get. |

### Response Body

Returns a single policy object (same shape as the list endpoint), or `404` if not found.

---

## Create Policy

Creates a new retention policy. The policy name must be unique across the system.

- **Endpoint:** `POST /policies`
- **Method:** `POST`
- **Authentication:** Required
- **Permission:** `manage:all`

### Request Body

| Field               | Type                  | Required | Description                                                                                    |
| ------------------- | --------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `name`              | `string`              | Yes      | Unique policy name. Max 255 characters.                                                        |
| `description`       | `string`              | No       | Human-readable description. Max 1000 characters.                                               |
| `priority`          | `integer`             | Yes      | Positive integer. Lower values indicate higher priority.                                       |
| `retentionPeriodDays` | `integer`           | Yes      | Number of days to retain matching emails. Minimum 1.                                           |
| `actionOnExpiry`    | `string`              | Yes      | Action to take when the retention period expires. Currently only `"delete_permanently"`.        |
| `isEnabled`         | `boolean`             | No       | Whether the policy is active. Defaults to `true`.                                              |
| `conditions`        | `RuleGroup \| null`   | No       | Condition rules for targeting specific emails. `null` matches all emails.                      |
| `ingestionScope`    | `string[] \| null`    | No       | Array of ingestion source UUIDs to scope the policy to. `null` applies to all sources.         |

#### Conditions (RuleGroup) Schema

```json
{
    "logicalOperator": "AND",
    "rules": [
        {
            "field": "sender",
            "operator": "domain_match",
            "value": "example.com"
        },
        {
            "field": "subject",
            "operator": "contains",
            "value": "invoice"
        }
    ]
}
```

**Supported fields:** `sender`, `recipient`, `subject`, `attachment_type`

**Supported operators:**

| Operator       | Description                                                        |
| -------------- | ------------------------------------------------------------------ |
| `equals`       | Exact case-insensitive match.                                      |
| `not_equals`   | Inverse of `equals`.                                               |
| `contains`     | Case-insensitive substring match.                                  |
| `not_contains` | Inverse of `contains`.                                             |
| `starts_with`  | Case-insensitive prefix match.                                     |
| `ends_with`    | Case-insensitive suffix match.                                     |
| `domain_match` | Matches when an email address ends with `@<value>`.                |
| `regex_match`  | ECMAScript regex (case-insensitive). Max pattern length: 200 chars.|

**Validation limits:**
- Maximum 50 rules per group.
- Rule `value` must be between 1 and 500 characters.

### Example Request

```json
{
    "name": "Finance Department - 10 Year",
    "description": "Extended retention for finance-related correspondence.",
    "priority": 2,
    "retentionPeriodDays": 3650,
    "actionOnExpiry": "delete_permanently",
    "conditions": {
        "logicalOperator": "OR",
        "rules": [
            {
                "field": "sender",
                "operator": "domain_match",
                "value": "finance.acme.com"
            },
            {
                "field": "recipient",
                "operator": "domain_match",
                "value": "finance.acme.com"
            }
        ]
    },
    "ingestionScope": ["b2c3d4e5-f6a7-8901-bcde-f23456789012"]
}
```

### Response

- **`201 Created`** — Returns the created policy object.
- **`409 Conflict`** — A policy with this name already exists.
- **`422 Unprocessable Entity`** — Validation errors.

---

## Update Policy

Updates an existing retention policy. Only the fields included in the request body are modified.

- **Endpoint:** `PUT /policies/:id`
- **Method:** `PUT`
- **Authentication:** Required
- **Permission:** `manage:all`

### Path Parameters

| Parameter | Type   | Description                       |
| --------- | ------ | --------------------------------- |
| `id`      | `uuid` | The UUID of the policy to update. |

### Request Body

All fields from the create endpoint are accepted, and all are optional. Only provided fields are updated.

To clear conditions (make the policy match all emails), send `"conditions": null`.

To clear ingestion scope (make the policy apply to all sources), send `"ingestionScope": null`.

### Response

- **`200 OK`** — Returns the updated policy object.
- **`404 Not Found`** — Policy with the given ID does not exist.
- **`422 Unprocessable Entity`** — Validation errors.

---

## Delete Policy

Permanently deletes a retention policy. This action is irreversible.

- **Endpoint:** `DELETE /policies/:id`
- **Method:** `DELETE`
- **Authentication:** Required
- **Permission:** `manage:all`

### Path Parameters

| Parameter | Type   | Description                       |
| --------- | ------ | --------------------------------- |
| `id`      | `uuid` | The UUID of the policy to delete. |

### Response

- **`204 No Content`** — Policy successfully deleted.
- **`404 Not Found`** — Policy with the given ID does not exist.

---

## Evaluate Email (Policy Simulator)

Evaluates a set of email metadata against all active policies and returns the applicable retention period and matching policy IDs. This endpoint does not modify any data — it is a read-only simulation tool.

- **Endpoint:** `POST /policies/evaluate`
- **Method:** `POST`
- **Authentication:** Required
- **Permission:** `manage:all`

### Request Body

| Field                              | Type       | Required | Description                                              |
| ---------------------------------- | ---------- | -------- | -------------------------------------------------------- |
| `emailMetadata.sender`             | `string`   | Yes      | Sender email address. Max 500 characters.                |
| `emailMetadata.recipients`         | `string[]` | Yes      | Recipient email addresses. Max 500 entries.              |
| `emailMetadata.subject`            | `string`   | Yes      | Email subject line. Max 2000 characters.                 |
| `emailMetadata.attachmentTypes`    | `string[]` | Yes      | File extensions (e.g., `[".pdf", ".xml"]`). Max 100.     |
| `emailMetadata.ingestionSourceId`  | `uuid`     | No       | Optional ingestion source UUID for scope-aware evaluation.|

### Example Request

```json
{
    "emailMetadata": {
        "sender": "cfo@finance.acme.com",
        "recipients": ["legal@acme.com"],
        "subject": "Q4 Invoice Reconciliation",
        "attachmentTypes": [".pdf", ".xlsx"],
        "ingestionSourceId": "b2c3d4e5-f6a7-8901-bcde-f23456789012"
    }
}
```

### Response Body

```json
{
    "appliedRetentionDays": 3650,
    "actionOnExpiry": "delete_permanently",
    "matchingPolicyIds": [
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "c3d4e5f6-a7b8-9012-cdef-345678901234"
    ]
}
```

| Field                  | Type       | Description                                                                           |
| ---------------------- | ---------- | ------------------------------------------------------------------------------------- |
| `appliedRetentionDays` | `integer`  | The longest retention period from all matching policies. `0` means no policy matched. |
| `actionOnExpiry`       | `string`   | The action to take on expiry. Currently always `"delete_permanently"`.                |
| `matchingPolicyIds`    | `string[]` | UUIDs of all policies that matched the provided metadata.                             |

### Response Codes

- **`200 OK`** — Evaluation completed.
- **`422 Unprocessable Entity`** — Validation errors in the request body.
