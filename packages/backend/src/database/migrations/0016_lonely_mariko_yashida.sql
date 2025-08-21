ALTER TABLE "roles" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_slug_unique" UNIQUE("slug");