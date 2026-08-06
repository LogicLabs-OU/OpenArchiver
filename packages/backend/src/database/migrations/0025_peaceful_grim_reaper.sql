ALTER TYPE "public"."audit_log_target_type" ADD VALUE 'RetentionPolicy' BEFORE 'Role';--> statement-breakpoint
ALTER TYPE "public"."audit_log_target_type" ADD VALUE 'SystemEvent' BEFORE 'SystemSettings';--> statement-breakpoint
ALTER TABLE "retention_policies" ADD COLUMN "ingestion_scope" jsonb DEFAULT 'null'::jsonb;