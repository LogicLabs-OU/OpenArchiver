CREATE TABLE "sync_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ingestion_source_id" uuid NOT NULL,
	"is_initial_import" boolean DEFAULT false NOT NULL,
	"total_mailboxes" integer DEFAULT 0 NOT NULL,
	"completed_mailboxes" integer DEFAULT 0 NOT NULL,
	"failed_mailboxes" integer DEFAULT 0 NOT NULL,
	"error_messages" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sync_sessions" ADD CONSTRAINT "sync_sessions_ingestion_source_id_ingestion_sources_id_fk" FOREIGN KEY ("ingestion_source_id") REFERENCES "public"."ingestion_sources"("id") ON DELETE cascade ON UPDATE no action;