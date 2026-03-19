# Get Started 👋

Welcome to Open Archiver! This guide will help you get started with setting up and using the platform.

## What is Open Archiver?

**A secure, sovereign, and affordable open-source platform for email archiving and eDiscovery.**

Open Archiver provides a robust, self-hosted solution for archiving, storing, indexing, and searching emails from major platforms, including Google Workspace (Gmail), Microsoft 365, as well as generic IMAP-enabled email inboxes. Use Open Archiver to keep a permanent, tamper-proof record of your communication history, free from vendor lock-in.

## Key Features

- **Universal Ingestion**: Connect to Google Workspace, Microsoft 365, and standard IMAP servers to perform initial bulk imports and maintain continuous, real-time synchronization.
- **Secure & Efficient Storage**: Emails are stored in the standard `.eml` format. The system uses deduplication and compression to minimize storage costs. All data is encrypted at rest.
- **Pluggable Storage Backends**: Support both local filesystem storage and S3-compatible object storage (like AWS S3 or MinIO).
- **Powerful Search & eDiscovery**: A high-performance search engine indexes the full text of emails and attachments (PDF, DOCX, etc.).
- **Compliance & Retention**: Define granular retention policies to automatically manage the lifecycle of your data. Place legal holds on communications to prevent deletion during litigation (TBD).
- **Comprehensive Auditing**: An immutable audit trail logs all system activities, ensuring you have a clear record of who accessed what and when (TBD).

## Installation

To get your own instance of Open Archiver running, follow our detailed installation guide:

- [Installation Guide](./user-guides/installation.md)

## Data Source Configuration 🔌

After deploying the application, you will need to configure one or more ingestion sources to begin archiving emails. Follow our detailed guides to connect to your email provider:

- [Connecting to Google Workspace](./user-guides/email-providers/google-workspace.md)
- [Connecting to Microsoft 365](./user-guides/email-providers/microsoft-365.md)
- [Connecting to a Generic IMAP Server](./user-guides/email-providers/imap.md)

## Contributing

We welcome contributions from the community!

- **Reporting Bugs**: If you find a bug, please open an issue on our GitHub repository.
- **Suggesting Enhancements**: Have an idea for a new feature? We'd love to hear it. Open an issue to start the discussion.
- **Code Contributions**: If you'd like to contribute code, please fork the repository and submit a pull request.

Please read our `CONTRIBUTING.md` file for more details on our code of conduct and the process for submitting pull requests.
