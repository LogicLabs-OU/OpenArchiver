# Legal Holds: API Endpoints

The legal holds feature exposes a RESTful API for managing holds and linking them to archived emails. All endpoints require authentication and appropriate permissions as specified below.

**Base URL:** `/api/v1/enterprise/legal-holds`

All endpoints also require the `LEGAL_HOLDS` feature to be enabled in the enterprise license.

---

## Hold Management Endpoints

### List All Holds

Retrieves all legal holds ordered by creation date ascending, each annotated with the count of currently linked emails.

- **Endpoint:** `GET /holds`
- **Method:** `GET`
- **Authentication:** Required
- **Permission:** `manage:all`

#### Response Body

```json
[
	{
		"id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
		"name": "Project Titan Litigation — 2026",
		"reason": "Preservation order received 2026-01-15 re: IP dispute",
		"isActive": true,
		"caseId": null,
		"emailCount": 4821,
		"createdAt": "2026-01-15T10:30:00.000Z",
		"updatedAt": "2026-01-15T10:30:00.000Z"
	},
	{
		"id": "b2c3d4e5-f6a7-8901-bcde-f23456789012",
		"name": "SEC Investigation Q3 2025",
		"reason": null,
		"isActive": false,
		"caseId": "c3d4e5f6-a7b8-9012-cdef-345678901234",
		"emailCount": 310,
		"createdAt": "2025-09-01T08:00:00.000Z",
		"updatedAt": "2025-11-20T16:45:00.000Z"
	}
]
```

---

### Get Hold by ID

Retrieves a single legal hold by its UUID.

- **Endpoint:** `GET /holds/:id`
- **Method:** `GET`
- **Authentication:** Required
- **Permission:** `manage:all`

#### Path Parameters

| Parameter | Type   | Description                  |
| --------- | ------ | ---------------------------- |
| `id`      | `uuid` | The UUID of the hold to get. |

#### Response

Returns a single hold object (same shape as the list endpoint), or `404` if not found.

---

### Create Hold

Creates a new legal hold. Holds are always created in the **active** state.

- **Endpoint:** `POST /holds`
- **Method:** `POST`
- **Authentication:** Required
- **Permission:** `manage:all`

#### Request Body

| Field    | Type     | Required | Description                                                    |
| -------- | -------- | -------- | -------------------------------------------------------------- |
| `name`   | `string` | Yes      | Unique hold name. Max 255 characters.                          |
| `reason` | `string` | No       | Legal basis or description for the hold. Max 2 000 characters. |
| `caseId` | `uuid`   | No       | Optional UUID of an `ediscovery_cases` record to link to.      |

#### Example Request

```json
{
	"name": "Project Titan Litigation — 2026",
	"reason": "Preservation notice received from outside counsel on 2026-01-15 regarding IP dispute with ExCorp.",
	"caseId": null
}
```

#### Response

- **`201 Created`** — Returns the created hold object with `emailCount: 0`.
- **`409 Conflict`** — A hold with this name already exists.
- **`422 Unprocessable Entity`** — Validation errors.

---

### Update Hold

Updates the name, reason, or `isActive` state of a hold. Only the fields provided in the request body are modified.

- **Endpoint:** `PUT /holds/:id`
- **Method:** `PUT`
- **Authentication:** Required
- **Permission:** `manage:all`

#### Path Parameters

| Parameter | Type   | Description                     |
| --------- | ------ | ------------------------------- |
| `id`      | `uuid` | The UUID of the hold to update. |

#### Request Body

All fields are optional. At least one must be provided.

| Field      | Type      | Description                                         |
| ---------- | --------- | --------------------------------------------------- |
| `name`     | `string`  | New hold name. Max 255 characters.                  |
| `reason`   | `string`  | Updated reason/description. Max 2 000 characters.   |
| `isActive` | `boolean` | Set to `false` to deactivate, `true` to reactivate. |

#### Example — Deactivate a Hold

```json
{
	"isActive": false
}
```

#### Response

- **`200 OK`** — Returns the updated hold object.
- **`404 Not Found`** — Hold with the given ID does not exist.
- **`422 Unprocessable Entity`** — Validation errors.

> **Important:** Setting `isActive` to `false` immediately lifts deletion immunity from all emails solely protected by this hold. The next lifecycle worker cycle will evaluate those emails against retention labels and policies.

---

### Delete Hold

Permanently deletes a legal hold and (via database CASCADE) all associated `email_legal_holds` rows.

- **Endpoint:** `DELETE /holds/:id`
- **Method:** `DELETE`
- **Authentication:** Required
- **Permission:** `manage:all`

#### Path Parameters

| Parameter | Type   | Description                     |
| --------- | ------ | ------------------------------- |
| `id`      | `uuid` | The UUID of the hold to delete. |

#### Response

- **`204 No Content`** — Hold successfully deleted.
- **`404 Not Found`** — Hold with the given ID does not exist.
- **`409 Conflict`** — The hold is currently active. Deactivate it first by calling `PUT /holds/:id` with `{ "isActive": false }`.

> **Security note:** Active holds cannot be deleted. This requirement forces an explicit, auditable deactivation step before the hold record is removed.

---

## Bulk Operations

### Bulk Apply Hold via Search Query

Applies a legal hold to **all emails matching a Meilisearch query**. The operation is asynchronous-safe: the UI fires the request and the server processes results in pages of 1 000, so even very large result sets do not time out.

- **Endpoint:** `POST /holds/:id/bulk-apply`
- **Method:** `POST`
- **Authentication:** Required
- **Permission:** `manage:all`

#### Path Parameters

| Parameter | Type   | Description                    |
| --------- | ------ | ------------------------------ |
| `id`      | `uuid` | The UUID of the hold to apply. |

#### Request Body

| Field         | Type     | Required | Description                                       |
| ------------- | -------- | -------- | ------------------------------------------------- |
| `searchQuery` | `object` | Yes      | A Meilisearch query object (see structure below). |

##### `searchQuery` Object

| Field              | Type     | Required | Description                                                         |
| ------------------ | -------- | -------- | ------------------------------------------------------------------- |
| `query`            | `string` | Yes      | Full-text search string. Pass `""` to match all documents.          |
| `filters`          | `object` | No       | Key-value filter object (e.g., `{ "from": "user@corp.com" }`).      |
| `matchingStrategy` | `string` | No       | Meilisearch matching strategy: `"last"`, `"all"`, or `"frequency"`. |

#### Example Request

```json
{
	"searchQuery": {
		"query": "Project Titan confidential",
		"filters": {
			"from": "john.doe@acme.com",
			"startDate": "2023-01-01",
			"endDate": "2025-12-31"
		},
		"matchingStrategy": "all"
	}
}
```

#### Response Body

```json
{
	"legalHoldId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
	"emailsLinked": 1247,
	"queryUsed": {
		"query": "Project Titan confidential",
		"filters": {
			"from": "john.doe@acme.com",
			"startDate": "2023-01-01",
			"endDate": "2025-12-31"
		},
		"matchingStrategy": "all"
	}
}
```

- `emailsLinked` — The number of emails **newly** linked to the hold by this operation. Emails already linked to this hold are not counted.
- `queryUsed` — The exact query JSON that was executed, mirroring what was written to the audit log for GoBD proof of scope.

#### Response Codes

- **`200 OK`** — Operation completed. Returns `emailsLinked: 0` if no new emails matched.
- **`404 Not Found`** — Hold with the given ID does not exist.
- **`409 Conflict`** — The hold is inactive. Only active holds can receive new email links.
- **`422 Unprocessable Entity`** — Invalid request body.

---

### Release All Emails from Hold

Removes all `email_legal_holds` associations for the given hold in a single operation. The hold itself is **not** deleted.

- **Endpoint:** `POST /holds/:id/release-all`
- **Method:** `POST`
- **Authentication:** Required
- **Permission:** `manage:all`

#### Path Parameters

| Parameter | Type   | Description                      |
| --------- | ------ | -------------------------------- |
| `id`      | `uuid` | The UUID of the hold to release. |

#### Response Body

```json
{
	"emailsReleased": 4821
}
```

#### Response Codes

- **`200 OK`** — All email associations removed. Returns `emailsReleased: 0` if the hold had no linked emails.
- **`500 Internal Server Error`** — The hold ID was not found or a database error occurred.

> **Warning:** After release, emails that were solely protected by this hold will be evaluated normally on the next lifecycle worker cycle. Emails with expired retention periods will be deleted.

---

## Per-Email Hold Endpoints

### Get Holds Applied to an Email

Returns all legal holds currently linked to a specific archived email, including both active and inactive holds.

- **Endpoint:** `GET /email/:emailId/holds`
- **Method:** `GET`
- **Authentication:** Required
- **Permission:** `read:archive`

#### Path Parameters

| Parameter | Type   | Description                     |
| --------- | ------ | ------------------------------- |
| `emailId` | `uuid` | The UUID of the archived email. |

#### Response Body

Returns an empty array `[]` if no holds are applied, or an array of hold-link objects:

```json
[
	{
		"legalHoldId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
		"holdName": "Project Titan Litigation — 2026",
		"isActive": true,
		"appliedAt": "2026-01-15T11:00:00.000Z",
		"appliedByUserId": "user-uuid-here"
	},
	{
		"legalHoldId": "b2c3d4e5-f6a7-8901-bcde-f23456789012",
		"holdName": "SEC Investigation Q3 2025",
		"isActive": false,
		"appliedAt": "2025-09-05T09:15:00.000Z",
		"appliedByUserId": null
	}
]
```

#### Response Codes

- **`200 OK`** — Returns the array of hold-link objects (may be empty).

---

### Apply a Hold to a Specific Email

Links a single archived email to an active legal hold. The operation is idempotent — linking the same email to the same hold twice has no effect.

- **Endpoint:** `POST /email/:emailId/holds`
- **Method:** `POST`
- **Authentication:** Required
- **Permission:** `manage:all`

#### Path Parameters

| Parameter | Type   | Description                     |
| --------- | ------ | ------------------------------- |
| `emailId` | `uuid` | The UUID of the archived email. |

#### Request Body

| Field    | Type   | Required | Description                    |
| -------- | ------ | -------- | ------------------------------ |
| `holdId` | `uuid` | Yes      | The UUID of the hold to apply. |

#### Example Request

```json
{
	"holdId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

#### Response Body

Returns the hold-link object with the DB-authoritative `appliedAt` timestamp:

```json
{
	"legalHoldId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
	"holdName": "Project Titan Litigation — 2026",
	"isActive": true,
	"appliedAt": "2026-01-16T14:22:00.000Z",
	"appliedByUserId": "user-uuid-here"
}
```

#### Response Codes

- **`200 OK`** — Hold successfully applied (or was already applied — idempotent).
- **`404 Not Found`** — Email or hold not found.
- **`409 Conflict`** — The hold is inactive and cannot be applied to new emails.
- **`422 Unprocessable Entity`** — Invalid request body.

---

### Remove a Hold from a Specific Email

Unlinks a specific legal hold from a specific archived email. The hold itself is not modified; other emails linked to the same hold are unaffected.

- **Endpoint:** `DELETE /email/:emailId/holds/:holdId`
- **Method:** `DELETE`
- **Authentication:** Required
- **Permission:** `manage:all`

#### Path Parameters

| Parameter | Type   | Description                     |
| --------- | ------ | ------------------------------- |
| `emailId` | `uuid` | The UUID of the archived email. |
| `holdId`  | `uuid` | The UUID of the hold to remove. |

#### Response Body

```json
{
	"message": "Hold removed from email successfully."
}
```

#### Response Codes

- **`200 OK`** — Hold link removed.
- **`404 Not Found`** — No such hold was applied to this email.

---

## Error Responses

All endpoints use the standard error response format:

```json
{
	"status": "error",
	"statusCode": 409,
	"message": "Cannot delete an active legal hold. Deactivate it first to explicitly lift legal protection before deletion.",
	"errors": null
}
```

For validation errors (`422 Unprocessable Entity`):

```json
{
	"status": "error",
	"statusCode": 422,
	"message": "Invalid input provided.",
	"errors": [
		{
			"field": "name",
			"message": "Name is required."
		}
	]
}
```

---

## Validation Constraints

| Field              | Constraint                               |
| ------------------ | ---------------------------------------- |
| Hold name          | 1–255 characters.                        |
| Reason             | Max 2 000 characters.                    |
| `caseId`           | Must be a valid UUID if provided.        |
| `holdId`           | Must be a valid UUID.                    |
| `emailId`          | Must be a valid UUID.                    |
| Search `query`     | String (may be empty `""`).              |
| `matchingStrategy` | One of `"last"`, `"all"`, `"frequency"`. |
