CREATE TYPE "public"."journaling_source_status" AS ENUM('active', 'paused');--> statement-breakpoint
ALTER TYPE "public"."ingestion_provider" ADD VALUE 'smtp_journaling';--> statement-breakpoint
ALTER TYPE "public"."audit_log_target_type" ADD VALUE 'JournalingSource' BEFORE 'RetentionPolicy';--> statement-breakpoint
CREATE TABLE "journaling_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"allowed_ips" jsonb NOT NULL,
	"require_tls" boolean DEFAULT true NOT NULL,
	"smtp_username" text,
	"smtp_password_hash" text,
	"status" "journaling_source_status" DEFAULT 'active' NOT NULL,
	"ingestion_source_id" uuid NOT NULL,
	"routing_address" text NOT NULL,
	"total_received" integer DEFAULT 0 NOT NULL,
	"last_received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "journaling_sources" ADD CONSTRAINT "journaling_sources_ingestion_source_id_ingestion_sources_id_fk" FOREIGN KEY ("ingestion_source_id") REFERENCES "public"."ingestion_sources"("id") ON DELETE cascade ON UPDATE no action;