# Pluggable Storage Service (`StorageService`)

## Overview

The `StorageService` provides a unified, abstract interface for handling file storage across different backends. Its primary purpose is to decouple the application's core logic from the underlying storage technology. This design allows administrators to switch between storage providers (e.g., from the local filesystem to an S3-compatible object store) with only a configuration change, requiring no modifications to the application code.

The service is built around a standardized `IStorageProvider` interface, which guarantees that all storage providers have a consistent API for common operations like storing, retrieving, and deleting files.

## Configuration

The `StorageService` is configured via environment variables in the `.env` file. You must specify the storage backend you wish to use and provide the necessary credentials and settings for it.

### 1. Choosing the Backend

The `STORAGE_TYPE` variable determines which provider the service will use.

- `STORAGE_TYPE=local`: Uses the local server's filesystem.
- `STORAGE_TYPE=s3`: Uses an S3-compatible object storage service (e.g., AWS S3, MinIO, Google Cloud Storage).

### 2. Local Filesystem Configuration

When `STORAGE_TYPE` is set to `local`, you must also provide the root path where files will be stored.

```env
# .env
STORAGE_TYPE=local
STORAGE_LOCAL_ROOT_PATH=/var/data/open-archiver
```

- `STORAGE_LOCAL_ROOT_PATH`: The absolute path on the server where the archive will be created. The service will create subdirectories within this path as needed.

### 3. S3-Compatible Storage Configuration

When `STORAGE_TYPE` is set to `s3`, you must provide the credentials and endpoint for your object storage provider.

```env
# .env
STORAGE_TYPE=s3
STORAGE_S3_ENDPOINT=http://127.0.0.1:9000
STORAGE_S3_BUCKET=email-archive
STORAGE_S3_ACCESS_KEY_ID=minioadmin
STORAGE_S3_SECRET_ACCESS_KEY=minioadmin
STORAGE_S3_REGION=us-east-1
STORAGE_S3_FORCE_PATH_STYLE=true
```

- `STORAGE_S3_ENDPOINT`: The full URL of the S3 API endpoint.
- `STORAGE_S3_BUCKET`: The name of the bucket to use for storage.
- `STORAGE_S3_ACCESS_KEY_ID`: The access key for your S3 user.
- `STORAGE_S3_SECRET_ACCESS_KEY`: The secret key for your S3 user.
- `STORAGE_S3_REGION` (Optional): The AWS region of your bucket. Recommended for AWS S3.
- `STORAGE_S3_FORCE_PATH_STYLE` (Optional): Set to `true` when using non-AWS S3 services like MinIO.

## How to Use the Service

The `StorageService` is designed to be used via dependency injection in other services. You should never instantiate the providers (`LocalFileSystemProvider` or `S3StorageProvider`) directly. Instead, create an instance of `StorageService` and the factory will provide the correct provider based on your `.env` configuration.

### Example: Usage in `IngestionService`

```typescript
import { StorageService } from './StorageService';

class IngestionService {
	private storageService: StorageService;

	constructor() {
		// The StorageService is instantiated without any arguments.
		// It automatically reads the configuration from the environment.
		this.storageService = new StorageService();
	}

	public async archiveEmail(rawEmail: Buffer, userId: string, messageId: string): Promise<void> {
		// Define a structured, unique path for the email.
		const archivePath = `${userId}/messages/${messageId}.eml`;

		try {
			// Use the service. It doesn't know or care if this is writing
			// to a local disk or an S3 bucket.
			await this.storageService.put(archivePath, rawEmail);
			console.log(`Successfully archived email to ${archivePath}`);
		} catch (error) {
			console.error(`Failed to archive email ${messageId}`, error);
		}
	}
}
```

## API Reference

The `StorageService` implements the `IStorageProvider` interface. All methods are asynchronous and return a `Promise`.

---

### `put(path, content)`

Stores a file at the specified path. If a file already exists at that path, it will be overwritten.

- **`path: string`**: A unique identifier for the file, including its directory structure (e.g., `"user-123/emails/message-abc.eml"`).
- **`content: Buffer | NodeJS.ReadableStream`**: The content of the file. It can be a `Buffer` for small files or a `ReadableStream` for large files to ensure memory efficiency.
- **Returns**: `Promise<void>` - A promise that resolves when the file has been successfully stored.

---

### `get(path)`

Retrieves a file from the specified path as a readable stream.

- **`path: string`**: The unique identifier of the file to retrieve.
- **Returns**: `Promise<NodeJS.ReadableStream>` - A promise that resolves with a readable stream of the file's content.
- **Throws**: An `Error` if the file is not found at the specified path.

---

### `delete(path)`

Deletes a file from the storage backend.

- **`path: string`**: The unique identifier of the file to delete.
- **Returns**: `Promise<void>` - A promise that resolves when the file is deleted. If the file does not exist, the promise will still resolve successfully without throwing an error.

---

### `exists(path)`

Checks for the existence of a file.

- **`path: string`**: The unique identifier of the file to check.
- **Returns**: `Promise<boolean>` - A promise that resolves with `true` if the file exists, and `false` otherwise.
