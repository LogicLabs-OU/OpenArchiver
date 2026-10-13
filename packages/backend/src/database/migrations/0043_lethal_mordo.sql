ALTER TYPE "public"."audit_log_action" ADD VALUE 'SSO_LOGIN';--> statement-breakpoint
ALTER TYPE "public"."audit_log_action" ADD VALUE 'SSO_JIT_PROVISION';--> statement-breakpoint
ALTER TYPE "public"."audit_log_action" ADD VALUE 'SSO_CONFIG_UPDATED';--> statement-breakpoint
ALTER TYPE "public"."audit_log_target_type" ADD VALUE 'SsoConnection';--> statement-breakpoint
CREATE TABLE "sso_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"protocol" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"issuer" text NOT NULL,
	"client_id" text,
	"client_secret" text,
	"saml_idp_metadata" text,
	"email_domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"jit_enabled" boolean DEFAULT true NOT NULL,
	"auto_link" boolean DEFAULT true NOT NULL,
	"default_role_id" uuid,
	"groups_claim" text DEFAULT 'groups' NOT NULL,
	"group_mappings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sync_roles_on_login" boolean DEFAULT true NOT NULL,
	"enforce_sso" boolean DEFAULT false NOT NULL,
	"last_successful_login_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sso_connections" ADD CONSTRAINT "sso_connections_default_role_id_roles_id_fk" FOREIGN KEY ("default_role_id") REFERENCES "public"."roles"("id") ON DELETE set null ON UPDATE no action;