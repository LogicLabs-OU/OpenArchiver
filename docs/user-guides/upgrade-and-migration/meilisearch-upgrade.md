# Upgrading Meilisearch

Meilisearch, the search engine used by Open Archiver, requires a manual data migration process when upgrading to a new version. This is because Meilisearch databases are only compatible with the specific version that created them.

If an Open Archiver upgrade includes a major Meilisearch version change, you will need to migrate your search index by following the process below.

## Migration Process Overview

For self-hosted instances using Docker Compose (as recommended), the migration process involves creating a data dump from your current Meilisearch instance, upgrading the Docker image, and then importing that dump into the new version.

### Step 1: Create a Dump

Before upgrading, you must create a dump of your existing Meilisearch data. You can do this by sending a POST request to the `/dumps` endpoint of the Meilisearch API.

1.  **Find your Meilisearch container name**:

    ```bash
    docker compose ps
    ```

    Look for the service name that corresponds to Meilisearch, usually `meilisearch`.

2.  **Execute the dump command**:
    You will need your Meilisearch Admin API key, which can be found in your `.env` file as `MEILI_MASTER_KEY`.

    ```bash
    curl -X POST 'http://localhost:7700/dumps' \
      -H "Authorization: Bearer YOUR_MEILI_MASTER_KEY"
    ```

    This will start the dump creation process. The dump file will be created inside the `meili_data` volume used by the Meilisearch container.

3.  **Monitor the dump status**:
    The dump creation request returns a `taskUid`. You can use this to check the status of the dump.

    For more details on dump and import, see the [official Meilisearch documentation](https://www.meilisearch.com/docs/learn/update_and_migration/updating).

### Step 2: Upgrade Your Open Archiver Instance

Once the dump is successfully created, you can proceed with the standard Open Archiver upgrade process.

1.  **Pull the latest changes and Docker images**:

    ```bash
    git pull
    docker compose pull
    ```

2.  **Stop the running services**:
    ```bash
    docker compose down
    ```

### Step 3: Import the Dump

Now, you need to restart the services while telling Meilisearch to import from your dump file.

1.  **Modify `docker-compose.yml`**:
    You need to temporarily add the `--import-dump` flag to the Meilisearch service command. Find the `meilisearch` service in your `docker-compose.yml` and modify the `command` section.

    You will need the name of your dump file. It will be a `.dump` file located in the directory mapped to `/meili_data` inside the container.

    ```yaml
    services:
        meilisearch:
            # ... other service config
            command:
                [
                    '--master-key=${MEILI_MASTER_KEY}',
                    '--env=production',
                    '--import-dump=/meili_data/dumps/YOUR_DUMP_FILE.dump',
                ]
    ```

2.  **Restart the services**:
    ```bash
    docker compose up -d
    ```
    Meilisearch will now start and import the data from the dump file. This may take some time depending on the size of your index.

### Step 4: Clean Up

Once the import is complete and you have verified that your search is working correctly, you should remove the `--import-dump` flag from your `docker-compose.yml` to prevent it from running on every startup.

1.  **Remove the `--import-dump` line** from the `command` section of the `meilisearch` service in `docker-compose.yml`.
2.  **Restart the services** one last time:
    ```bash
    docker compose up -d
    ```

Your Meilisearch instance is now upgraded and running with your migrated data.

For more advanced scenarios or troubleshooting, please refer to the **[official Meilisearch migration guide](https://www.meilisearch.com/docs/learn/update_and_migration/updating)**.
