# PST Import

OpenArchiver allows you to import PST files. This is useful for importing emails from a variety of sources, including Microsoft Outlook.

## Preparing the PST File

To ensure a successful import, you should prepare your PST file according to the following guidelines:

- **Structure:** The PST file can contain any number of emails, organized in any folder structure. The folder structure will be preserved in OpenArchiver, so you can use it to organize your emails.
- **Password Protection:** OpenArchiver does not support password-protected PST files. Please remove the password from your PST file before importing it.

## Creating a PST Ingestion Source

1.  Go to the **Ingestion Sources** page in the OpenArchiver dashboard.
2.  Click the **Create New** button.
3.  Select **PST Import** as the provider.
4.  Enter a name for the ingestion source.
5.  **Choose Import Method:**
    *   **Upload File:** Click **Choose File** and select the PST file from your computer. (Best for smaller files)
    *   **Local Path:** Enter the path to the PST file **inside the container**. (Best for large files)

    > **Note on Local Path:** When using Docker, the "Local Path" is relative to the container's filesystem.
    > *   **Recommended:** Place your file in a `temp` folder inside your configured storage directory (`STORAGE_LOCAL_ROOT_PATH`). This path is already mounted. For example, if your storage path is `/data`, put the file in `/data/temp/archive.pst` and enter `/data/temp/archive.pst` as the path.
    > *   **Alternative:** Mount a separate volume in `docker-compose.yml` (e.g., `- /host/path:/container/path`) and use the container path.

6.  Click the **Submit** button.

OpenArchiver will then start importing the emails from the PST file. The ingestion process may take some time, depending on the size of the file.
