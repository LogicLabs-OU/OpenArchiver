# Audit Log: API Endpoints

The audit log feature exposes two API endpoints for retrieving and verifying audit log data. Both endpoints require authentication and are only accessible to users with the appropriate permissions.

## Get Audit Logs

Retrieves a paginated list of audit log entries, with support for filtering and sorting.

- **Endpoint:** `GET /api/v1/enterprise/audit-logs`
- **Method:** `GET`
- **Authentication:** Required

### Query Parameters

| Parameter    | Type     | Description                                                                 |
| ------------ | -------- | --------------------------------------------------------------------------- |
| `page`       | `number` | The page number to retrieve. Defaults to `1`.                               |
| `limit`      | `number` | The number of entries to retrieve per page. Defaults to `20`.               |
| `startDate`  | `date`   | The start date for the date range filter.                                   |
| `endDate`    | `date`   | The end date for the date range filter.                                     |
| `actor`      | `string` | The actor identifier to filter by.                                          |
| `actionType` | `string` | The action type to filter by (e.g., `LOGIN`, `CREATE`).                     |
| `sort`       | `string` | The sort order for the results. Can be `asc` or `desc`. Defaults to `desc`. |

### Response Body

```json
{
	"data": [
		{
			"id": 1,
			"previousHash": null,
			"timestamp": "2025-10-03T00:00:00.000Z",
			"actorIdentifier": "e8026a75-b58a-4902-8858-eb8780215f82",
			"actorIp": "::1",
			"actionType": "LOGIN",
			"targetType": "User",
			"targetId": "e8026a75-b58a-4902-8858-eb8780215f82",
			"details": {},
			"currentHash": "..."
		}
	],
	"meta": {
		"total": 100,
		"page": 1,
		"limit": 20
	}
}
```

## Verify Audit Log Integrity

Initiates a verification process to check the integrity of the entire audit log chain.

- **Endpoint:** `POST /api/v1/enterprise/audit-logs/verify`
- **Method:** `POST`
- **Authentication:** Required

### Response Body

**Success**

```json
{
	"ok": true,
	"message": "Audit log integrity verified successfully."
}
```

**Failure**

```json
{
	"ok": false,
	"message": "Audit log chain is broken!",
	"logId": 123
}
```
