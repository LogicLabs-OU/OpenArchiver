# EML Import

OpenArchiver allows you to import EML files from a zip archive. This is useful for importing emails from a variety of sources, including other email clients and services.

## Preparing the Zip File

To ensure a successful import, you should compress your .eml files to one zip file according to the following guidelines:

- **Structure:** The zip file can contain any number of `.eml` files, organized in any folder structure. The folder structure will be preserved in OpenArchiver, so you can use it to organize your emails.
- **Compression:** The zip file should be compressed using standard zip compression.

Here's an example of a valid folder structure:

```
archive.zip
├── inbox
│   ├── email-01.eml
│   └── email-02.eml
├── sent
│   └── email-03.eml
└── drafts
    ├── nested-folder
    │   └── email-04.eml
    └── email-05.eml
```

## Creating an EML Ingestion Source

1.  Go to the **Ingestion Sources** page in the OpenArchiver dashboard.
2.  Click the **Create New** button.
3.  Select **EML Import** as the provider.
4.  Enter a name for the ingestion source.
5.  **Choose Import Method:**
    *   **Upload File:** Click **Choose File** and select the zip archive containing your EML files. (Best for smaller archives)
    *   **Local Path:** Enter the path to the zip file **inside the container**. (Best for large archives)

    > **Note on Local Path:** When using Docker, the "Local Path" is relative to the container's filesystem.
    > *   **Recommended:** Place your zip file in a `temp` folder inside your configured storage directory (`STORAGE_LOCAL_ROOT_PATH`). This path is already mounted. For example, if your storage path is `/data`, put the file in `/data/temp/emails.zip` and enter `/data/temp/emails.zip` as the path.
    > *   **Alternative:** Mount a separate volume in `docker-compose.yml` (e.g., `- /host/path:/container/path`) and use the container path.

6.  Click the **Submit** button.

OpenArchiver will then start importing the EML files from the zip archive. The ingestion process may take some time, depending on the size of the archive.
