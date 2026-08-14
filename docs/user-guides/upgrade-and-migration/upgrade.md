# Upgrading Your Instance

This guide provides instructions for upgrading your Open Archiver instance to the latest version.

## Checking for New Versions

Open Archiver automatically checks for new versions and will display a notification in the footer of the web interface when an update is available. You can find a list of all releases and their release notes on the [GitHub Releases](https://github.com/LogicLabs-OU/OpenArchiver/releases) page.

## Upgrading Your Instance

To upgrade your Open Archiver instance, follow these steps:

1.  **Pull the latest changes from the repository**:

    ```bash
    git pull
    ```

2.  **Pull the latest Docker images**:

    ```bash
    docker compose pull
    ```

3.  **Restart the services with the new images**:
    ```bash
    docker compose up -d
    ```

This will restart your Open Archiver instance with the latest version of the application.

## Migrating Data

When you upgrade to a new version, database migrations are applied automatically when the application starts up. This ensures that your database schema is always up-to-date with the latest version of the application.

No manual intervention is required for database migrations.

There is one exception, and it applies only when upgrading from v0.5.1. If the application fails to start with `index row requires N bytes, maximum size is 8191` in the migration output, see [Long Message-ID Headers](../troubleshooting/long-message-id.md).

## The `ADMIN_EMAIL` and `ADMIN_PASSWORD` variables are no longer used

Very early versions of Open Archiver configured the administrator account through the `ADMIN_EMAIL` and `ADMIN_PASSWORD` environment variables. A compatibility shim kept honouring them and created the account automatically on first start. That shim has been removed.

The first administrator is now created only on the `/setup` page, which appears automatically the first time you open an instance that has no accounts yet. If your `.env` still defines `ADMIN_EMAIL` or `ADMIN_PASSWORD`, they are ignored and can be deleted.

Instances that already completed the upgrade are unaffected, because the administrator account is stored in the database. Only an instance that has never had a user created — for example a reinstall against an empty database — will show the setup page again.

## Upgrading Meilisearch

When an Open Archiver update includes a major version change for Meilisearch, you will need to manually migrate your search data. This process is not covered by the standard upgrade commands.

For detailed instructions, please see the [Meilisearch Upgrade Guide](./meilisearch-upgrade.md).
