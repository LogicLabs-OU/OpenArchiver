# Jobs API

The Jobs API provides endpoints for monitoring the job queues and the jobs within them.

## Overview

Open Archiver uses a job queue system to handle asynchronous tasks like email ingestion and indexing. The system is built on Redis and BullMQ and uses a producer-consumer pattern.

### Job Statuses

Jobs can have one of the following statuses:

- **active:** The job is currently being processed.
- **completed:** The job has been completed successfully.
- **failed:** The job has failed after all retry attempts.
- **delayed:** The job is delayed and will be processed at a later time.
- **waiting:** The job is waiting to be processed.
- **paused:** The job is paused and will not be processed until it is resumed.

### Errors

When a job fails, the `failedReason` and `stacktrace` fields will contain information about the error. The `error` field will also be populated with the `failedReason` for easier access.

### Job Preservation

Jobs are preserved for a limited time after they are completed or failed. This means that the job counts and the jobs that you see in the API are for a limited time.

- **Completed jobs:** The last 1000 completed jobs are preserved.
- **Failed jobs:** The last 5000 failed jobs are preserved.

## Get All Queues

- **Endpoint:** `GET /v1/jobs/queues`
- **Description:** Retrieves a list of all job queues and their job counts.
- **Permissions:** `manage:all`
- **Responses:**
    - `200 OK`: Returns a list of queue overviews.
    - `401 Unauthorized`: If the user is not authenticated.
    - `403 Forbidden`: If the user does not have the required permissions.

### Response Body

```json
{
	"queues": [
		{
			"name": "ingestion",
			"counts": {
				"active": 0,
				"completed": 56,
				"failed": 4,
				"delayed": 3,
				"waiting": 0,
				"paused": 0
			}
		},
		{
			"name": "indexing",
			"counts": {
				"active": 0,
				"completed": 0,
				"failed": 0,
				"delayed": 0,
				"waiting": 0,
				"paused": 0
			}
		}
	]
}
```

## Get Queue Jobs

- **Endpoint:** `GET /v1/jobs/queues/:queueName`
- **Description:** Retrieves a list of jobs within a specific queue, with pagination and filtering by status.
- **Permissions:** `manage:all`
- **URL Parameters:**
    - `queueName` (string, required): The name of the queue to retrieve jobs from.
- **Query Parameters:**
    - `status` (string, optional): The status of the jobs to retrieve. Can be one of `active`, `completed`, `failed`, `delayed`, `waiting`, `paused`. Defaults to `failed`.
    - `page` (number, optional): The page number to retrieve. Defaults to `1`.
    - `limit` (number, optional): The number of jobs to retrieve per page. Defaults to `10`.
- **Responses:**
    - `200 OK`: Returns a detailed view of the queue, including a paginated list of jobs.
    - `401 Unauthorized`: If the user is not authenticated.
    - `403 Forbidden`: If the user does not have the required permissions.
    - `404 Not Found`: If the specified queue does not exist.

### Response Body

```json
{
	"name": "ingestion",
	"counts": {
		"active": 0,
		"completed": 56,
		"failed": 4,
		"delayed": 3,
		"waiting": 0,
		"paused": 0
	},
	"jobs": [
		{
			"id": "1",
			"name": "initial-import",
			"data": {
				"ingestionSourceId": "clx1y2z3a0000b4d2e5f6g7h8"
			},
			"state": "failed",
			"failedReason": "Error: Connection timed out",
			"timestamp": 1678886400000,
			"processedOn": 1678886401000,
			"finishedOn": 1678886402000,
			"attemptsMade": 5,
			"stacktrace": ["..."],
			"returnValue": null,
			"ingestionSourceId": "clx1y2z3a0000b4d2e5f6g7h8",
			"error": "Error: Connection timed out"
		}
	],
	"pagination": {
		"currentPage": 1,
		"totalPages": 1,
		"totalJobs": 4,
		"limit": 10
	}
}
```
