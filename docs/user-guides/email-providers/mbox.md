# Mbox Ingestion

Mbox is a common format for storing email messages. This guide will walk you through the process of ingesting mbox files into OpenArchiver.

## 1. Exporting from Your Email Client

Most email clients that support mbox exports will allow you to export a folder of emails as a single `.mbox` file. Here are the general steps:

- **Mozilla Thunderbird**: Right-click on a folder, select **ImportExportTools NG**, and then choose **Export folder**.
- **Gmail**: You can use Google Takeout to export your emails in mbox format.
- **Other Clients**: Refer to your email client's documentation for instructions on how to export emails to an mbox file.

## 2. Uploading to OpenArchiver

Once you have your `.mbox` file, you can upload it to OpenArchiver through the web interface.

1.  Navigate to the **Ingestion** page.
2.  Click on the **New Ingestion** button.
3.  Select **Mbox** as the source type.
4.  Upload your `.mbox` file.

## 3. Folder Structure

OpenArchiver will attempt to preserve the original folder structure of your emails. This is done by inspecting the following email headers:

- `X-Gmail-Labels`: Used by Gmail to store labels.
- `X-Folder`: A custom header used by some email clients like Thunderbird.

If neither of these headers is present, the emails will be ingested into the root of the archive.
