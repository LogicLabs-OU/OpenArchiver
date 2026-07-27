CREATE TYPE "public"."email_encryption_status" AS ENUM('none', 'encrypted', 'decrypted', 'decrypt_failed');--> statement-breakpoint
CREATE TYPE "public"."email_signature_status" AS ENUM('none', 'signed_unverified', 'signed_valid', 'signed_invalid', 'signed_unverifiable');--> statement-breakpoint
ALTER TABLE "archived_emails" ADD COLUMN "encryption_status" "email_encryption_status" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "archived_emails" ADD COLUMN "signature_status" "email_signature_status" DEFAULT 'none' NOT NULL;--> statement-breakpoint
CREATE INDEX "archived_emails_undecrypted_idx" ON "archived_emails" USING btree ("id") WHERE "archived_emails"."encryption_status" IN ('encrypted', 'decrypt_failed');