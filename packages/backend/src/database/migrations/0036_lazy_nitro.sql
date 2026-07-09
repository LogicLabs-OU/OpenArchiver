ALTER TYPE "public"."audit_log_action" ADD VALUE 'TOTP_ENROLLED';--> statement-breakpoint
ALTER TYPE "public"."audit_log_action" ADD VALUE 'TOTP_DISABLED';--> statement-breakpoint
ALTER TYPE "public"."audit_log_action" ADD VALUE 'MFA_VERIFY_SUCCESS';--> statement-breakpoint
ALTER TYPE "public"."audit_log_action" ADD VALUE 'MFA_VERIFY_FAIL';--> statement-breakpoint
ALTER TYPE "public"."audit_log_action" ADD VALUE 'BACKUP_CODE_USED';--> statement-breakpoint
ALTER TYPE "public"."audit_log_action" ADD VALUE 'BACKUP_CODES_REGENERATED';--> statement-breakpoint
ALTER TYPE "public"."audit_log_action" ADD VALUE 'SECURITY_POLICY_UPDATED';--> statement-breakpoint
ALTER TYPE "public"."audit_log_target_type" ADD VALUE 'SecurityPolicy';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_secret" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_enrolled_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_backup_codes" jsonb;