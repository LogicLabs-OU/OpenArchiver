ALTER TABLE "archived_emails" ADD COLUMN "is_journaled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "ingestion_sources" ADD COLUMN "merged_into_id" uuid;--> statement-breakpoint
CREATE INDEX "idx_merged_into" ON "ingestion_sources" USING btree ("merged_into_id");