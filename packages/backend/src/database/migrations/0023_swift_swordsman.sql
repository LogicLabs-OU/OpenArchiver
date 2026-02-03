DROP INDEX "source_hash_unique";--> statement-breakpoint
CREATE INDEX "source_hash_idx" ON "attachments" USING btree ("ingestion_source_id","content_hash_sha256");