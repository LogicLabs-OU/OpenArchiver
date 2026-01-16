# Ingestion Service API

The Ingestion Service manages ingestion sources, which are configurations for connecting to email providers and importing emails.

## Endpoints

All endpoints in this service require authentication.

### POST /api/v1/ingestion-sources

Creates a new ingestion source.

**Access:** Authenticated

#### Request Body

The request body should be a `CreateIngestionSourceDto` object.

```typescript
interface CreateIngestionSourceDto {
	name: string;
	provider: 'google_workspace' | 'microsoft_365' | 'generic_imap' | 'pst_import' | 'eml_import' | 'mbox_import';
	providerConfig: IngestionCredentials;
}
```

#### Responses

- **201 Created:** The newly created ingestion source.
- **500 Internal Server Error:** An unexpected error occurred.

### GET /api/v1/ingestion-sources

Retrieves all ingestion sources.

**Access:** Authenticated

#### Responses

- **200 OK:** An array of ingestion source objects.
- **500 Internal Server Error:** An unexpected error occurred.

### GET /api/v1/ingestion-sources/:id

Retrieves a single ingestion source by its ID.

**Access:** Authenticated

#### URL Parameters

| Parameter | Type   | Description                     |
| :-------- | :----- | :------------------------------ |
| `id`      | string | The ID of the ingestion source. |

#### Responses

- **200 OK:** The ingestion source object.
- **404 Not Found:** Ingestion source not found.
- **500 Internal Server Error:** An unexpected error occurred.

### PUT /api/v1/ingestion-sources/:id

Updates an existing ingestion source.

**Access:** Authenticated

#### URL Parameters

| Parameter | Type   | Description                     |
| :-------- | :----- | :------------------------------ |
| `id`      | string | The ID of the ingestion source. |

#### Request Body

The request body should be an `UpdateIngestionSourceDto` object.

```typescript
interface UpdateIngestionSourceDto {
	name?: string;
	provider?: 'google' | 'microsoft' | 'generic_imap';
	providerConfig?: IngestionCredentials;
	status?: 'pending_auth' | 'auth_success' | 'importing' | 'active' | 'paused' | 'error';
}
```

#### Responses

- **200 OK:** The updated ingestion source object.
- **404 Not Found:** Ingestion source not found.
- **500 Internal Server Error:** An unexpected error occurred.

### DELETE /api/v1/ingestion-sources/:id

Deletes an ingestion source and all associated data.

**Access:** Authenticated

#### URL Parameters

| Parameter | Type   | Description                     |
| :-------- | :----- | :------------------------------ |
| `id`      | string | The ID of the ingestion source. |

#### Responses

- **204 No Content:** The ingestion source was deleted successfully.
- **404 Not Found:** Ingestion source not found.
- **500 Internal Server Error:** An unexpected error occurred.

### POST /api/v1/ingestion-sources/:id/import

Triggers the initial import process for an ingestion source.

**Access:** Authenticated

#### URL Parameters

| Parameter | Type   | Description                     |
| :-------- | :----- | :------------------------------ |
| `id`      | string | The ID of the ingestion source. |

#### Responses

- **202 Accepted:** The initial import was triggered successfully.
- **404 Not Found:** Ingestion source not found.
- **500 Internal Server Error:** An unexpected error occurred.

### POST /api/v1/ingestion-sources/:id/pause

Pauses an active ingestion source.

**Access:** Authenticated

#### URL Parameters

| Parameter | Type   | Description                     |
| :-------- | :----- | :------------------------------ |
| `id`      | string | The ID of the ingestion source. |

#### Responses

- **200 OK:** The updated ingestion source object with a `paused` status.
- **404 Not Found:** Ingestion source not found.
- **500 Internal Server Error:** An unexpected error occurred.

### POST /api/v1/ingestion-sources/:id/sync

Triggers a forced synchronization for an ingestion source.

**Access:** Authenticated

#### URL Parameters

| Parameter | Type   | Description                     |
| :-------- | :----- | :------------------------------ |
| `id`      | string | The ID of the ingestion source. |

#### Responses

- **202 Accepted:** The force sync was triggered successfully.
- **404 Not Found:** Ingestion source not found.
- **500 Internal Server Error:** An unexpected error occurred.
