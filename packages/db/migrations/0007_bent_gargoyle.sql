CREATE TABLE IF NOT EXISTS "integration_settings" (
	"provider" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"secret_ciphertext" text,
	"config" jsonb,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "linear_activity" (
	"linear_issue_id" text PRIMARY KEY NOT NULL,
	"identifier" text,
	"title" text,
	"url" text,
	"state_type" text,
	"assignee_email" text,
	"assignee_name" text,
	"completed_at" timestamp with time zone,
	"issue_updated_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now()
);

--> statement-breakpoint
-- Lookup index for Phase 2: a member's issues completed in a time window.
CREATE INDEX IF NOT EXISTS "linear_activity_assignee_completed" ON "linear_activity" ("assignee_email","completed_at");
