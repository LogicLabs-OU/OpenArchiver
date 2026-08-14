# Startup Fails: "index row requires N bytes, maximum size is 8191"

This applies to a single, narrow case: upgrading an instance that ran **v0.5.1** and archived an
email with an unusually long `Message-ID` header. On upgrade the application fails to start.

If you are already running v0.5.2 or later, this cannot affect you — see
[Why only v0.5.1](#why-only-v0-5-1) below.

## Symptoms

The backend container exits during startup, and the logs end with a failed migration:

```
Running migrations...
Migration failed! error: index row requires 15744 bytes, maximum size is 8191
```

The application never becomes available, and restarting produces the same error.

## Root Cause

`archived_emails.message_id_header` holds the `Message-ID` header exactly as the mail server sent
it, and that header has no length limit in practice — a malformed or deliberately hostile message
can carry one that runs to kilobytes.

v0.5.2 added an index over that column to speed up deduplication. PostgreSQL cannot index a value
that large, so if your archive already contains one, building the index fails and the migration
stops. Because migrations run at startup, the application stops with it.

Newer versions shorten these values as emails are archived, so no new row can trigger this. Rows
written by v0.5.1, before the index existed, are the exception: they are already in the table when
the index is built.

## Solution

Shorten the affected values, then restart. The original headers are unaffected — they live in the
archived `.eml` files, which are the record of what was received. The column being shortened is
internal bookkeeping used to recognise an email the system has already seen.

1.  **Connect to your database.** With the standard Docker Compose setup:

    ```bash
    docker compose exec postgres psql -U postgres -d postgres
    ```

2.  **Check how many rows are affected.** Usually a handful at most:

    ```sql
    SELECT count(*) FROM archived_emails WHERE octet_length(message_id_header) > 998;
    ```

3.  **Shorten them.** This keeps the first 900 characters and appends a hash of the full value, so
    two different messages cannot end up sharing a key:

    ```sql
    UPDATE archived_emails
    SET message_id_header = left(message_id_header, 900) || '-' || md5(message_id_header)
    WHERE octet_length(message_id_header) > 998;
    ```

4.  **Repeat for the provider ID column**, which stores the same header for IMAP and for file
    imports:

    ```sql
    UPDATE archived_emails
    SET provider_message_id = left(provider_message_id, 900) || '-' || md5(provider_message_id)
    WHERE octet_length(provider_message_id) > 998;
    ```

5.  **Restart.** The migration re-runs from where it stopped and now completes:

    ```bash
    docker compose up -d --force-recreate
    ```

The affected emails stay in the archive and remain searchable. The only change is the internal key
used to recognise them, so on the next sync each one may be archived a second time as a duplicate of
itself. If that matters to you, note the `Message-ID` values before running the update.

## Why only v0.5.1 {#why-only-v0-5-1}

An instance that is running v0.5.2 or later has, by definition, already built this index
successfully, which means no row large enough to break it was present. Any email that arrived
afterwards with such a header was rejected at insert time and reported as a failed message rather
than stored — so it is not in the table either.

That rejection was itself a bug ([#440](https://github.com/LogicLabs-OU/OpenArchiver/issues/440)):
the email was counted as failed and the ingestion source went into an error state, but it was never
archived and every retry failed the same way. Later versions shorten the value before storing it, so
these emails are archived normally.
