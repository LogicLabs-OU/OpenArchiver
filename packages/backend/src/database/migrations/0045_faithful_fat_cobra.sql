CREATE TYPE "public"."mailbox_kind" AS ENUM('user', 'shared', 'room', 'equipment', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."mailbox_kind_evidence" AS ENUM('provider', 'pattern', 'admin', 'none');--> statement-breakpoint
CREATE TYPE "public"."seat_identity_evidence" AS ENUM('provider', 'alias_domain', 'admin_link', 'address');--> statement-breakpoint
ALTER TYPE "public"."audit_log_action" ADD VALUE 'SEAT_CLASSIFICATION_UPDATED';--> statement-breakpoint
ALTER TYPE "public"."audit_log_action" ADD VALUE 'SEAT_IDENTITY_LINK_UPDATED';--> statement-breakpoint
ALTER TYPE "public"."audit_log_action" ADD VALUE 'SEAT_POLICY_UPDATED';--> statement-breakpoint
ALTER TYPE "public"."audit_log_target_type" ADD VALUE 'Mailbox';--> statement-breakpoint
ALTER TYPE "public"."audit_log_target_type" ADD VALUE 'SeatPolicy';--> statement-breakpoint
CREATE TABLE "mailboxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"address" text NOT NULL,
	"display_name" text,
	"provider" "ingestion_provider" NOT NULL,
	"source_id" uuid,
	"root_source_id" uuid,
	"provider_object_id" text,
	"provider_aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider_kind" "mailbox_kind",
	"purpose_checked_at" timestamp with time zone,
	"licensed" boolean,
	"account_enabled" boolean,
	"has_mailbox" boolean,
	"last_listed_at" timestamp with time zone,
	"active" boolean DEFAULT false NOT NULL,
	"email_count" bigint DEFAULT 0 NOT NULL,
	"last_archived_at" timestamp with time zone,
	"is_sentinel" boolean DEFAULT false NOT NULL,
	"admin_kind" "mailbox_kind",
	"admin_declared_by" uuid,
	"admin_declared_at" timestamp with time zone,
	"admin_declared_reason" text,
	"linked_to_mailbox_id" uuid,
	"linked_by" uuid,
	"linked_at" timestamp with time zone,
	"link_reason" text,
	"kind" "mailbox_kind" DEFAULT 'unknown' NOT NULL,
	"kind_evidence" "mailbox_kind_evidence" DEFAULT 'none' NOT NULL,
	"identity_key" text NOT NULL,
	"identity_evidence" "seat_identity_evidence" DEFAULT 'address' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mailboxes_address_unique" UNIQUE("address")
);
--> statement-breakpoint
DROP TABLE "custodians" CASCADE;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_source_id_ingestion_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."ingestion_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_root_source_id_ingestion_sources_id_fk" FOREIGN KEY ("root_source_id") REFERENCES "public"."ingestion_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_admin_declared_by_users_id_fk" FOREIGN KEY ("admin_declared_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_linked_to_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("linked_to_mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_linked_by_users_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mailboxes_identity_key_idx" ON "mailboxes" USING btree ("identity_key");--> statement-breakpoint
CREATE INDEX "mailboxes_root_source_idx" ON "mailboxes" USING btree ("root_source_id");--> statement-breakpoint
CREATE INDEX "mailboxes_provider_object_idx" ON "mailboxes" USING btree ("provider","provider_object_id");