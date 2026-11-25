# Upgrading to the Enterprise Edition

This guide explains how to move an existing Open Archiver installation from the Open Source Edition to the Enterprise Edition.

The upgrade is done in place. You only need to replace the Docker image and add the license key in the environment variable; your database, archived emails, search index and settings remain as they are. Nothing needs to be re-imported, and users, roles and ingestion sources keep working without changes.

## Overview

| What needs to change                              | What stays the same                             |
| ------------------------------------------------- | ----------------------------------------------- |
| The application image (`-enterprise` tag)         | The PostgreSQL database and all archived emails |
| A license key in your `.env` file                 | Stored files (local disk or S3)                 |
| Optionally, the SMTP journaling port and settings | The Meilisearch index, Valkey and Tika services |
|                                                   | Your encryption keys and all other settings     |

The Enterprise image contains everything in the Open Source Edition, so all existing features continue to work after the upgrade.

## Before you start

### Your license key

You receive a license key when you purchase the Enterprise Edition. It is a long text string (a signed JWT). Keep it available for step 2.

### Choose the Enterprise release

Upgrade to the latest Enterprise release by using the -enterprise tag Docker images (see details below). If you need to pin a specific older Enterprise release instead, contact us first so we can confirm it is compatible with your current database.

### Network access

Enterprise deployments contact the license server at `https://openarchiver.com` once a day and when the application starts to check license validity. Allow outbound HTTPS (port 443) from the Open Archiver server to `openarchiver.com`. No private data from your archive is sent to the server. We only report seat numbers and instance version. See [License checks and offline operation](#license-checks-and-offline-operation) for what is sent.

## Step 1: Back up

Back up before any upgrade. Run these commands from the directory that contains your `docker-compose.yml`.

1. **Database:**

    ```bash
    docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > open-archiver-db.sql
    ```

2. **Optionally, stored emails and attachments.**

> This step is **optional** because upgrade to the Enterprise Edition generally doesn't break archived emails and files. This step may consume a large storage space.

If you use local storage with the default named volume, copy the volume to an archive file. The volume name starts with your Compose project name, usually the name of the directory, for example `open-archiver_archiver-data`:

    ```bash
    docker volume ls | grep archiver-data
    docker run --rm -v open-archiver_archiver-data:/data -v "$PWD":/backup alpine \
        tar czf /backup/archiver-data.tgz -C /data .
    ```

    If you store files in S3, the bucket is not changed by the upgrade.

3. **Configuration.** Copy your `.env` file to a safe place. It contains `STORAGE_ENCRYPTION_KEY` and `ENCRYPTION_KEY`. Without them, encrypted emails and stored credentials cannot be read, by you or by anyone else.

## Step 2: Add the license key

Open your `.env` file and add the license key:

```bash
# --- License (Enterprise only) ---
OA_LICENSE_KEY=eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9...
```

Paste the whole key on one line.

::: tip Alternatively, you can use a license file instead if you prefer not to keep the license key in `.env`. Save the license key as a file named `license.jwt` and mount it into the container:

```yaml
services:
    open-archiver:
        volumes:
            - './license.jwt:/app/packages/enterprise/dist/modules/license/license.jwt:ro'
```

`OA_LICENSE_KEY` in the `.env` file takes precedence when both are present.
:::

## Step 3: Switch to the Enterprise image

Open `docker-compose.yml` and change the image of the `open-archiver` service:

```yaml
services:
    open-archiver:
        # Before: image: logiclabshq/open-archiver:latest
        image: logiclabshq/open-archiver:latest-enterprise
```

`latest-enterprise` always points to the newest Enterprise release. To pin a version, use the release tag with the `-enterprise` suffix instead, for example `logiclabshq/open-archiver:v1.6.0-enterprise`.

Leave the other services (`postgres`, `valkey`, `meilisearch`, `tika`) unchanged.

## Step 4: Set up SMTP journaling (optional)

Skip this step if you do not plan to use [SMTP journaling](../journaling/guide.md). You can also set it up later.

1. Publish the journaling port by adding it to the `ports` of the `open-archiver` service:

    ```yaml
    services:
        open-archiver:
            ports:
                - '3000:${PORT_FRONTEND:-3000}' # Frontend
                - '25:${SMTP_JOURNALING_PORT:-2525}' # SMTP journaling listener
    ```

2. Add the journaling settings to `.env`:

    ```bash
    # --- SMTP Journaling (Enterprise only) ---
    SMTP_JOURNALING_PORT=2525
    SMTP_JOURNALING_DOMAIN=journal.yourdomain.com
    ```

3. Create the MX record and open port 25 in your firewall as described in the [SMTP Journaling guide](../journaling/guide.md).

## Step 5: Restart with the new image

```bash
docker compose pull
docker compose up -d
```

Database migrations run automatically when the container starts. No manual step is needed.

## Step 6: Verify the upgrade

1. **Check the logs.** The startup log should contain a line confirming the license:

    ```bash
    docker compose logs open-archiver | grep -i license
    ```

    Expected: `Enterprise license successfully verified for: <your company name>`.

2. **Open the License Status page.** Sign in as a Super Admin and go to **Admin → License Status**. The page shows your company name, the license status, the seats in your plan and the enabled features.

3. **Open an Enterprise page.** In the Open Source Edition, pages such as **Compliance → Audit Log** show an "Enterprise Edition" notice. After the upgrade, they show the feature itself. The Enterprise features are found here:

    | Menu       | Features                                                     |
    | ---------- | ------------------------------------------------------------ |
    | Archive    | SMTP Journaling                                              |
    | Compliance | Audit Log, Retention Policies, Retention Labels, Legal Holds |
    | Admin      | Security Policy, Single Sign-On, License Status              |

## License checks and offline operation

Once a day, and when the application starts, Open Archiver contacts `https://openarchiver.com` to verify the license. The request contains the license identifier, a deployment identifier, the software version, the number of seats and the breakdown behind that number. No email content, email addresses, names or attachments are sent. See [Seat Counting](../seats/guide.md) for details.

If the license server cannot be reached, Enterprise features keep working for the offline grace period (14 days unless your license says otherwise). After that, Enterprise features are switched off until the next successful check. The archive itself, search, ingestion and all Open Source Edition features keep working throughout. The license is checked again at the next daily check; you can also click **Revalidate License** on the License Status page to check immediately.

For large deployments in air-gapped environments, license reporting can be disabled so the archive never needs to contact the license server. Contact us to enable this for your license.

## Several application servers

If you run more than one Open Archiver application server against the same database, upgrade all of them to the same Enterprise image and give all of them the same license key. They share one database and therefore count as one deployment with one seat count.

## Troubleshooting

**The log shows `License key not found.`**
The key is missing or empty. Check that `OA_LICENSE_KEY` is set in the `.env` file the container uses, or that `license.jwt` is mounted at the path shown in step 2. Restart the container after changing either.

**Enterprise pages still show the "Enterprise Edition" notice.**
The container is still running the open-source image. Check the image with `docker compose ps` and run `docker compose pull` and `docker compose up -d` again.

**The License Status page shows "Offline grace remaining".**
The license server has not been reached recently; **Last verified** shows when it last succeeded. Check that the server can open outbound HTTPS connections to `openarchiver.com`, then click **Revalidate License**. Enterprise features keep working until the grace period runs out.

**The License Status page warns that the license key is used on more than one instance.**
Each license key belongs to one deployment. Make sure no other installation, such as a test system or a copy, runs with the same key, or contact your account manager to add instances.

## Switching back to the Open Source Edition

If you need to return to the Open Source Edition, contact us first so we can tell you which open-source release is compatible with your database. Then change the image back to that release, remove `OA_LICENSE_KEY`, and restart. Your archive and all data remain intact, and the Enterprise data (policies, labels, holds, audit log) stays in the database for a later upgrade.

::: warning
Without the Enterprise Edition, Enterprise rules are no longer applied. Legal holds no longer prevent deletion, retention policies and labels are no longer enforced, and journaled emails are no longer received. If you rely on legal holds, make sure deletion stays disabled (`ENABLE_DELETION` not set to `true`) while you run the Open Source Edition.
:::
