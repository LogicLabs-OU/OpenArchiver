ALTER TABLE "journaling_sources" ADD COLUMN IF NOT EXISTS "total_failed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "journaling_sources" ADD COLUMN IF NOT EXISTS "last_failed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "journaling_sources" ADD COLUMN IF NOT EXISTS "last_error_message" text;--> statement-breakpoint
ALTER TABLE "journaling_sources" ADD COLUMN IF NOT EXISTS "last_quarantine_path" text;