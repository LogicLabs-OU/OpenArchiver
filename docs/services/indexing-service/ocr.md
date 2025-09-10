# Attachment OCR

Open Archiver includes a powerful Optical Character Recognition (OCR) feature that allows it to extract text from images and scanned PDF documents during indexing. This makes the content of image-based attachments fully searchable.

## Overview

When enabled, the OCR service automatically processes common image formats and acts as a fallback for PDF files that do not contain selectable text. This is particularly useful for scanned documents, faxes, or photos of text.

## Enabling OCR

To enable the OCR feature, you must set the following environment variable in your `.env` file:

```ini
OCR_ENABLED=true
```

By default, this feature is disabled. If you do not need OCR, you can set this to `false` or omit the variable.

## Step-by-Step Language Configuration

The OCR service requires language data files to recognize text. You can add support for one or more languages by following these steps:

1.  **Download Language Files**: Visit the official Tesseract `tessdata_fast` repository to find the available language files: [https://github.com/tesseract-ocr/tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast). Download the `.traineddata` file for each language you need (e.g., `fra.traineddata` for French, `deu.traineddata` for German).

2.  **Create a Directory on Host**: On your **host machine** (the machine running Docker), create a directory at any location to store your language files. For example, `/opt/openarchiver/tessdata`.

3.  **Add Language Files**: Place the downloaded `.traineddata` files into the directory you just created.

4.  **Configure Paths and Languages in `.env`**: Update your `.env` file with the following variables:
    - `TESSERACT_PATH`: Set this to the **full, absolute path** of the directory you created in Step 2.
    - `OCR_LANGUAGES`: Set this to a comma-separated list of the language codes you downloaded.

    ```ini
    # Example configuration in .env file
    TESSERACT_PATH="/opt/openarchiver/tessdata"
    OCR_LANGUAGES="eng,fra,deu"
    ```

## Docker Compose Configuration

The system uses a Docker volume to make the language files on your host machine available to the application inside the container. The `docker-compose.yml` file is already configured to use the `TESSERACT_PATH` variable from your `.env` file.

```yaml
services:
    open-archiver:
        # ... other settings
        volumes:
            - archiver-data:/var/data/open-archiver
            # (Optional) Mount a host directory containing Tesseract language files for OCR.
            # If you do not need OCR, you can safely comment out or remove the line below.
            - ${TESSERACT_PATH:-./tessdata}:/opt/open-archiver/tessdata:ro
```

This line connects the host path specified in `TESSERACT_PATH` (defaulting to `./tessdata` if not set) to the fixed `/opt/open-archiver/tessdata` path inside the container. If you have disabled OCR, you can comment out or remove the volume mount line.

## Performance Note

OCR is a CPU-intensive process. To ensure the main application remains responsive, all OCR operations are handled by background workers. The number of concurrent OCR processes is automatically scaled based on the number of available CPU cores on your system.
