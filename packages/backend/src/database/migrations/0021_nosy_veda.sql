CREATE TYPE "public"."audit_log_action" AS ENUM('CREATE', 'READ', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'SETUP', 'IMPORT', 'PAUSE', 'SYNC', 'UPLOAD', 'SEARCH', 'DOWNLOAD', 'GENERATE');--> statement-breakpoint
CREATE TYPE "public"."audit_log_target_type" AS ENUM('ApiKey', 'ArchivedEmail', 'Dashboard', 'IngestionSource', 'Role', 'SystemSettings', 'User', 'File');--> statement-breakpoint
ALTER TABLE "audit_logs" ALTER COLUMN "target_type" SET DATA TYPE "public"."audit_log_target_type" USING "target_type"::"public"."audit_log_target_type";--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "previous_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "actor_ip" text;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "action_type" "audit_log_action" NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "current_hash" varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_logs" DROP COLUMN "action";--> statement-breakpoint
ALTER TABLE "audit_logs" DROP COLUMN "is_tamper_evident";