ALTER TABLE "archived_emails" ALTER COLUMN "sent_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "archived_emails" ADD COLUMN "original_date_source" text DEFAULT 'header' NOT NULL;--> statement-breakpoint
ALTER TABLE "archived_emails" ADD COLUMN "date_backfilled_at" timestamp with time zone;