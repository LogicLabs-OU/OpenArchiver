ALTER TABLE "journaling_sources" ADD COLUMN "total_failed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "journaling_sources" ADD COLUMN "last_failed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "journaling_sources" ADD COLUMN "last_error_message" text;--> statement-breakpoint
ALTER TABLE "journaling_sources" ADD COLUMN "last_quarantine_path" text;