---
aside: false
---

# Upload API

Upload files (PST, EML, MBOX) to temporary storage before creating a file-based ingestion source. The returned `filePath` should be passed as `uploadedFilePath` in the ingestion source `providerConfig`.

## Upload a File

<OAOperation operationId="uploadFile" />
