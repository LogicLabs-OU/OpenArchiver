ALTER TABLE "attachments" DROP CONSTRAINT "attachments_content_hash_sha256_unique";--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "ingestion_source_id" uuid;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_ingestion_source_id_ingestion_sources_id_fk" FOREIGN KEY ("ingestion_source_id") REFERENCES "public"."ingestion_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "source_hash_unique" ON "attachments" USING btree ("ingestion_source_id","content_hash_sha256");