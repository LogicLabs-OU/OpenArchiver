# Retention Labels: API Endpoints

The retention labels feature exposes a RESTful API for managing retention labels and applying them to individual archived emails. All endpoints require authentication and appropriate permissions as specified below.

**Base URL:** `/api/v1/enterprise/retention-policy`

All endpoints also require the `RETENTION_POLICY` feature to be enabled in the enterprise license.

---

## Label Management Endpoints

### List All Labels

Retrieves all retention labels, ordered by creation date ascending.

- **Endpoint:** `GET /labels`
- **Method:** `GET`
- **Authentication:** Required
- **Permission:** `manage:all`

#### Response Body

```json
[
	{
		"id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
		"name": "Legal Hold - Litigation ABC",
		"description": "Extended retention for emails related to litigation ABC vs Company",
		"retentionPeriodDays": 2555,
		"isDisabled": false,
		"createdAt": "2025-10-01T00:00:00.000Z"
	},
	{
		"id": "b2c3d4e5-f6a7-8901-bcde-f23456789012",
		"name": "Executive Communications",
		"description": null,
		"retentionPeriodDays": 3650,
		"isDisabled": true,
		"createdAt": "2025-09-15T12:30:00.000Z"
	}
]
```

---

### Get Label by ID

Retrieves a single retention label by its UUID.

- **Endpoint:** `GET /labels/:id`
- **Method:** `GET`
- **Authentication:** Required
- **Permission:** `manage:all`

#### Path Parameters

| Parameter | Type   | Description                   |
| --------- | ------ | ----------------------------- |
| `id`      | `uuid` | The UUID of the label to get. |

#### Response Body

Returns a single label object (same shape as the list endpoint), or `404` if not found.

---

### Create Label

Creates a new retention label. The label name must be unique across the system.

- **Endpoint:** `POST /labels`
- **Method:** `POST`
- **Authentication:** Required
- **Permission:** `manage:all`

#### Request Body

| Field                 | Type      | Required | Description                                                 |
| --------------------- | --------- | -------- | ----------------------------------------------------------- |
| `name`                | `string`  | Yes      | Unique label name. Max 255 characters.                      |
| `description`         | `string`  | No       | Human-readable description. Max 1000 characters.            |
| `retentionPeriodDays` | `integer` | Yes      | Number of days to retain emails with this label. Minimum 1. |

#### Example Request

```json
{
	"name": "Financial Records - Q4 2025",
	"description": "Extended retention for Q4 2025 financial correspondence per regulatory requirements",
	"retentionPeriodDays": 2555
}
```

#### Response

- **`201 Created`** — Returns the created label object.
- **`409 Conflict`** — A label with this name already exists.
- **`422 Unprocessable Entity`** — Validation errors.

---

### Update Label

Updates an existing retention label. Only the fields included in the request body are modified.

- **Endpoint:** `PUT /labels/:id`
- **Method:** `PUT`
- **Authentication:** Required
- **Permission:** `manage:all`

#### Path Parameters

| Parameter | Type   | Description                      |
| --------- | ------ | -------------------------------- |
| `id`      | `uuid` | The UUID of the label to update. |

#### Request Body

All fields from the create endpoint are accepted, and all are optional. Only provided fields are updated.

**Important:** The `retentionPeriodDays` field cannot be modified if the label is currently applied to any emails. Attempting to do so will return a `409 Conflict` error.

#### Example Request

```json
{
	"name": "Financial Records - Q4 2025 (Updated)",
	"description": "Updated description for Q4 2025 financial records retention"
}
```

#### Response

- **`200 OK`** — Returns the updated label object.
- **`404 Not Found`** — Label with the given ID does not exist.
- **`409 Conflict`** — Attempted to modify retention period while label is applied to emails.
- **`422 Unprocessable Entity`** — Validation errors.

---

### Delete Label

Deletes or disables a retention label depending on its usage status.

- **Endpoint:** `DELETE /labels/:id`
- **Method:** `DELETE`
- **Authentication:** Required
- **Permission:** `manage:all`

#### Path Parameters

| Parameter | Type   | Description                      |
| --------- | ------ | -------------------------------- |
| `id`      | `uuid` | The UUID of the label to delete. |

#### Deletion Logic

- **Hard Delete**: If the label has never been applied to any emails, it is permanently removed.
- **Soft Disable**: If the label is currently applied to one or more emails, it is marked as `isDisabled = true` instead of being deleted. This preserves the retention clock for tagged emails while preventing new applications.

#### Response Body

```json
{
	"action": "deleted"
}
```

or

```json
{
	"action": "disabled"
}
```

#### Response Codes

- **`200 OK`** — Label successfully deleted or disabled. Check the `action` field in the response body.
- **`404 Not Found`** — Label with the given ID does not exist.

---

## Email Label Endpoints

### Get Email's Label

Retrieves the retention label currently applied to a specific archived email.

- **Endpoint:** `GET /email/:emailId/label`
- **Method:** `GET`
- **Authentication:** Required
- **Permission:** `read:archive`

#### Path Parameters

| Parameter | Type   | Description                     |
| --------- | ------ | ------------------------------- |
| `emailId` | `uuid` | The UUID of the archived email. |

#### Response Body

Returns `null` if no label is applied:

```json
null
```

Or the label information if a label is applied:

```json
{
	"labelId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
	"labelName": "Legal Hold - Litigation ABC",
	"retentionPeriodDays": 2555,
	"appliedAt": "2025-10-15T14:30:00.000Z",
	"appliedByUserId": "user123"
}
```

#### Response Codes

- **`200 OK`** — Returns label information or `null`.
- **`500 Internal Server Error`** — Server error during processing.

---

### Apply Label to Email

Applies a retention label to an archived email. If the email already has a label, the existing label is replaced.

- **Endpoint:** `POST /email/:emailId/label`
- **Method:** `POST`
- **Authentication:** Required
- **Permission:** `delete:archive`

#### Path Parameters

| Parameter | Type   | Description                     |
| --------- | ------ | ------------------------------- |
| `emailId` | `uuid` | The UUID of the archived email. |

#### Request Body

| Field     | Type   | Required | Description                     |
| --------- | ------ | -------- | ------------------------------- |
| `labelId` | `uuid` | Yes      | The UUID of the label to apply. |

#### Example Request

```json
{
	"labelId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

#### Response Body

```json
{
	"labelId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
	"labelName": "Legal Hold - Litigation ABC",
	"retentionPeriodDays": 2555,
	"appliedAt": "2025-10-15T14:30:00.000Z",
	"appliedByUserId": "user123"
}
```

#### Response Codes

- **`200 OK`** — Label successfully applied.
- **`404 Not Found`** — Email or label not found.
- **`409 Conflict`** — Attempted to apply a disabled label.
- **`422 Unprocessable Entity`** — Invalid request body.

---

### Remove Label from Email

Removes the retention label from an archived email if one is applied.

- **Endpoint:** `DELETE /email/:emailId/label`
- **Method:** `DELETE`
- **Authentication:** Required
- **Permission:** `delete:archive`

#### Path Parameters

| Parameter | Type   | Description                     |
| --------- | ------ | ------------------------------- |
| `emailId` | `uuid` | The UUID of the archived email. |

#### Response Body

If a label was removed:

```json
{
	"message": "Label removed successfully."
}
```

If no label was applied:

```json
{
	"message": "No label was applied to this email."
}
```

#### Response Codes

- **`200 OK`** — Operation completed (regardless of whether a label was actually removed).
- **`500 Internal Server Error`** — Server error during processing.

---

## Error Responses

All endpoints use the standard error response format:

```json
{
	"status": "error",
	"statusCode": 404,
	"message": "The requested resource could not be found.",
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
		},
		{
			"field": "retentionPeriodDays",
			"message": "Retention period must be at least 1 day."
		}
	]
}
```

## Validation Constraints

| Field            | Constraint                        |
| ---------------- | --------------------------------- |
| Label name       | 1–255 characters, must be unique. |
| Description      | Max 1000 characters.              |
| Retention period | Positive integer (≥ 1 day).       |
| Label ID (UUID)  | Must be a valid UUID format.      |
| Email ID (UUID)  | Must be a valid UUID format.      |
