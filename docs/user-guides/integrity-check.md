# Integrity Check

Open Archiver allows you to verify the integrity of your archived emails and their attachments. This guide explains how the integrity check works and what the results mean.

## How It Works

When an email is archived, Open Archiver calculates a unique cryptographic signature (a SHA256 hash) for the email's raw `.eml` file and for each of its attachments. These signatures are stored in the database alongside the email's metadata.

The integrity check feature recalculates these signatures for the stored files and compares them to the original signatures stored in the database. This process allows you to verify that the content of your archived emails has not been altered, corrupted, or tampered with since the moment they were archived.

## The Integrity Report

When you view an email in the Open Archiver interface, an integrity report is automatically generated and displayed. This report provides a clear, at-a-glance status for the email file and each of its attachments.

### Statuses

- **Valid (Green Badge):** A "Valid" status means that the current signature of the file matches the original signature stored in the database. This is the expected status and indicates that the file's integrity is intact.

- **Invalid (Red Badge):** An "Invalid" status means that the current signature of the file does _not_ match the original signature. This indicates that the file's content has changed since it was archived.

### Reasons for an "Invalid" Status

If a file is marked as "Invalid," you can hover over the badge to see a reason for the failure. Common reasons include:

- **Stored hash does not match current hash:** This is the most common reason and indicates that the file's content has been modified. This could be due to accidental changes, data corruption, or unauthorized tampering.

- **Could not read attachment file from storage:** This message indicates that the file could not be read from its storage location. This could be due to a storage system issue, a file permission problem, or because the file has been deleted.

## What to Do If an Integrity Check Fails

If you encounter an "Invalid" status for an email or attachment, it is important to investigate the issue. Here are some steps you can take:

1.  **Check Storage:** Verify that the file exists in its storage location and that its permissions are correct.
2.  **Review Audit Logs:** If you have audit logging enabled, review the logs for any unauthorized access or modifications to the file.
3.  **Restore from Backup:** If you suspect data corruption, you may need to restore the affected file from a backup.

The integrity check feature is a crucial tool for ensuring the long-term reliability and trustworthiness of your email archive. By regularly monitoring the integrity of your archived data, you can be confident that your records are accurate and complete.
