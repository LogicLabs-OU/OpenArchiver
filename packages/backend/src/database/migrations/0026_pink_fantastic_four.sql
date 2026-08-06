ALTER TYPE "public"."audit_log_target_type" ADD VALUE 'RetentionLabel' BEFORE 'Role';--> statement-breakpoint
ALTER TYPE "public"."audit_log_target_type" ADD VALUE 'LegalHold' BEFORE 'Role';--> statement-breakpoint
ALTER TABLE "email_legal_holds" ADD COLUMN "applied_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "email_legal_holds" ADD COLUMN "applied_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "retention_labels" ADD COLUMN "is_disabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "email_legal_holds" ADD CONSTRAINT "email_legal_holds_applied_by_user_id_users_id_fk" FOREIGN KEY ("applied_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;