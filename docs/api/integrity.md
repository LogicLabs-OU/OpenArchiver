# Integrity Check API

The Integrity Check API provides an endpoint to verify the cryptographic hash of an archived email and its attachments against the stored values in the database. This allows you to ensure that the stored files have not been tampered with or corrupted since they were archived.

## Check Email Integrity

Verifies the integrity of a specific archived email and all of its associated attachments.

- **URL:** `/api/v1/integrity/:id`
- **Method:** `GET`
- **URL Params:**
    - `id=[string]` (required) - The UUID of the archived email to check.
- **Permissions:** `read:archive`
- **Success Response:**
    - **Code:** 200 OK
    - **Content:** `IntegrityCheckResult[]`

### Response Body `IntegrityCheckResult`

An array of objects, each representing the result of an integrity check for a single file (either the email itself or an attachment).

| Field      | Type                      | Description                                                                 |
| :--------- | :------------------------ | :-------------------------------------------------------------------------- |
| `type`     | `'email' \| 'attachment'` | The type of the file being checked.                                         |
| `id`       | `string`                  | The UUID of the email or attachment.                                        |
| `filename` | `string` (optional)       | The filename of the attachment. This field is only present for attachments. |
| `isValid`  | `boolean`                 | `true` if the current hash matches the stored hash, otherwise `false`.      |
| `reason`   | `string` (optional)       | A reason for the failure. Only present if `isValid` is `false`.             |

### Example Response

```json
[
	{
		"type": "email",
		"id": "a1b2c3d4-e5f6-7890-1234-567890abcdef",
		"isValid": true
	},
	{
		"type": "attachment",
		"id": "b2c3d4e5-f6a7-8901-2345-67890abcdef1",
		"filename": "document.pdf",
		"isValid": false,
		"reason": "Stored hash does not match current hash."
	}
]
```

- **Error Response:**
    - **Code:** 404 Not Found
    - **Content:** `{ "message": "Archived email not found" }`
