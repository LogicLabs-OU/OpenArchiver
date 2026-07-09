ALTER TABLE "archived_emails" ADD COLUMN "index_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Backfill: existing rows were archived before is_indexed was tracked and are
-- already present in the search index. Mark them indexed so the new reconcile
-- job does not force a full reindex of the entire archive on upgrade. Genuine
-- pre-existing gaps surface via the index-health indicator (DB count vs index
-- count) and are healed with a manual reindex.
UPDATE "archived_emails" SET "is_indexed" = true WHERE "is_indexed" = false;--> statement-breakpoint
CREATE INDEX "archived_emails_unindexed_idx" ON "archived_emails" USING btree ("id") WHERE "archived_emails"."is_indexed" = false;