/** Parse a positive-integer env var, falling back to `fallback` when unset,
 *  non-numeric, or <= 0. Keeps a bad value from silently zeroing a pool/batch. */
const intFromEnv = (name: string, fallback: number): number => {
	const raw = process.env[name];
	if (!raw) return fallback;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * Concurrency and batch-size tuning for the ingestion + indexing pipeline.
 * All values are overridable via environment variables; the defaults preserve
 * the previously hard-coded / inline behavior. See .env.example for docs.
 */
export const ingestionConfig = {
	/** Emails processed concurrently within a single mailbox job, so per-email
	 *  DB + object-storage latency overlaps. `1` = strictly serial. */
	emailConcurrency: intFromEnv('INGESTION_EMAIL_CONCURRENCY', 8),

	/** BullMQ ingestion worker: how many mailbox/import jobs run at once. */
	workerConcurrency: intFromEnv('INGESTION_WORKER_CONCURRENCY', 5),

	/** UID window fetched per IMAP FETCH batch (envelope scan + body fetch). */
	imapFetchBatchSize: intFromEnv('IMAP_FETCH_BATCH_SIZE', 250),

	/** BullMQ indexing worker: how many index-email-batch jobs run at once. */
	indexingWorkerConcurrency: intFromEnv('INDEXING_WORKER_CONCURRENCY', 1),

	/** Documents built concurrently within one index-email-batch job (each build
	 *  reads the .eml from storage + parses it). */
	indexingDocumentBuildConcurrency: intFromEnv('INDEXING_DOCUMENT_BUILD_CONCURRENCY', 10),

	/** Keyset page size for the reindex `is_indexed` reset scan. */
	reindexResetBatchSize: intFromEnv('REINDEX_RESET_BATCH_SIZE', 5000),
};
