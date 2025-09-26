# OCR Service

The OCR (Optical Character Recognition) and text extraction service is responsible for extracting plain text content from various file formats, such as PDFs, Office documents, and more. This is a crucial component for making email attachments searchable.

## Overview

The system employs a two-pronged approach for text extraction:

1.  **Primary Extractor (Apache Tika)**: A powerful and versatile toolkit that can extract text from a wide variety of file formats. It is the recommended method for its superior performance and format support.
2.  **Legacy Extractor**: A fallback mechanism that uses a combination of libraries (`pdf2json`, `mammoth`, `xlsx`) for common file types like PDF, DOCX, and XLSX. This is used when Apache Tika is not configured.

The main logic resides in `packages/backend/src/helpers/textExtractor.ts`, which decides which extraction method to use based on the application's configuration.

## Configuration

To enable the primary text extraction method, you must configure the URL of an Apache Tika server instance in your environment variables.

In your `.env` file, set the `TIKA_URL`:

```env
# .env.example

# Apache Tika Integration
# ONLY active if TIKA_URL is set
TIKA_URL=http://tika:9998
```

If `TIKA_URL` is not set, the system will automatically fall back to the legacy extraction methods. The service performs a health check on startup to verify connectivity with the Tika server.

## File Size Limits

To prevent excessive memory usage and processing time, the service imposes a general size limit on files submitted for text extraction. Files larger than the configured limit will be skipped.

- **With Apache Tika**: The maximum file size is **100MB**.
- **With Legacy Fallback**: The maximum file size is **50MB**.

## Supported File Formats

The service's ability to extract text depends on whether it's using Apache Tika or the legacy fallback methods.

### With Apache Tika

When `TIKA_URL` is configured, the service can process a vast range of file formats. Apache Tika is designed for broad compatibility and supports hundreds of file types, including but not limited to:

- Portable Document Format (PDF)
- Microsoft Office formats (DOC, DOCX, PPT, PPTX, XLS, XLSX)
- OpenDocument Formats (ODT, ODS, ODP)
- Rich Text Format (RTF)
- Plain Text (TXT, CSV, JSON, XML, HTML)
- Image formats with OCR capabilities (PNG, JPEG, TIFF)
- Archive formats (ZIP, TAR, GZ)
- Email formats (EML, MSG)

For a complete and up-to-date list, please refer to the official [Apache Tika documentation](https://tika.apache.org/3.2.3/formats.html).

### With Legacy Fallback

When Tika is not configured, text extraction is limited to the following formats:

- `application/pdf` (PDF)
- `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (DOCX)
- `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (XLSX)
- Plain text formats such as `text/*`, `application/json`, and `application/xml`.

## Features of the Tika Integration (`OcrService`)

The `OcrService` (`packages/backend/src/services/OcrService.ts`) provides several enhancements to make text extraction efficient and robust.

### Caching

To avoid redundant processing of the same file, the service implements a simple LRU (Least Recently Used) cache.

- **Cache Key**: A SHA-256 hash of the file's buffer is used as the cache key.
- **Functionality**: If a file with the same hash is processed again, the text content is served directly from the cache, saving significant processing time.
- **Statistics**: The service keeps track of cache hits, misses, and the hit rate for performance monitoring.

### Concurrency Management (Semaphore)

Extracting text from large files can be resource-intensive. To prevent the Tika server from being overwhelmed by multiple requests for the _same file_ simultaneously (e.g., during a large import), a semaphore mechanism is used.

- **Functionality**: If a request for a specific file (identified by its hash) is already in progress, any subsequent requests for the same file will wait for the first one to complete and then use its result.
- **Benefit**: This deduplicates parallel processing efforts and reduces unnecessary load on the Tika server.

### Health Check and DNS Fallback

- **Availability Check**: The service includes a `checkTikaAvailability` method to verify that the Tika server is reachable and operational. This check is performed on application startup.
- **DNS Fallback**: For convenience in Docker environments, if the Tika URL uses the hostname `tika` (e.g., `http://tika:9998`), the service will automatically attempt a fallback to `localhost` if the initial connection fails.

## Legacy Fallback Methods

When Tika is not available, the `extractTextLegacy` function in `textExtractor.ts` handles extraction for a limited set of MIME types:

- `application/pdf`: Processed using `pdf2json`. Includes a 50MB size limit and a 5-second timeout to prevent memory issues.
- `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (DOCX): Processed using `mammoth`.
- `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (XLSX): Processed using `xlsx`.
- Plain text formats (`text/*`, `application/json`, `application/xml`): Converted directly from the buffer.
