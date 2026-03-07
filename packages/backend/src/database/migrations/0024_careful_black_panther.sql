CREATE TABLE "email_legal_holds" (
	"email_id" uuid NOT NULL,
	"legal_hold_id" uuid NOT NULL,
	CONSTRAINT "email_legal_holds_email_id_legal_hold_id_pk" PRIMARY KEY("email_id","legal_hold_id")
);
--> statement-breakpoint
CREATE TABLE "email_retention_labels" (
	"email_id" uuid NOT NULL,
	"label_id" uuid NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_by_user_id" uuid,
	CONSTRAINT "email_retention_labels_email_id_label_id_pk" PRIMARY KEY("email_id","label_id")
);
--> statement-breakpoint
CREATE TABLE "retention_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_name" varchar(255) NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"event_timestamp" timestamp with time zone NOT NULL,
	"target_criteria" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retention_labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"retention_period_days" integer NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "legal_holds" DROP CONSTRAINT "legal_holds_custodian_id_custodians_id_fk";
--> statement-breakpoint
ALTER TABLE "legal_holds" DROP CONSTRAINT "legal_holds_case_id_ediscovery_cases_id_fk";
--> statement-breakpoint
ALTER TABLE "legal_holds" ALTER COLUMN "case_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD COLUMN "name" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "email_legal_holds" ADD CONSTRAINT "email_legal_holds_email_id_archived_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."archived_emails"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_legal_holds" ADD CONSTRAINT "email_legal_holds_legal_hold_id_legal_holds_id_fk" FOREIGN KEY ("legal_hold_id") REFERENCES "public"."legal_holds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_retention_labels" ADD CONSTRAINT "email_retention_labels_email_id_archived_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."archived_emails"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_retention_labels" ADD CONSTRAINT "email_retention_labels_label_id_retention_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."retention_labels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_retention_labels" ADD CONSTRAINT "email_retention_labels_applied_by_user_id_users_id_fk" FOREIGN KEY ("applied_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_case_id_ediscovery_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."ediscovery_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_holds" DROP COLUMN "custodian_id";--> statement-breakpoint
ALTER TABLE "legal_holds" DROP COLUMN "hold_criteria";--> statement-breakpoint
ALTER TABLE "legal_holds" DROP COLUMN "applied_by_identifier";--> statement-breakpoint
ALTER TABLE "legal_holds" DROP COLUMN "applied_at";--> statement-breakpoint
ALTER TABLE "legal_holds" DROP COLUMN "removed_at";