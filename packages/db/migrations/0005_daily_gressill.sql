DO $$ BEGIN
 CREATE TYPE "public"."user_role" AS ENUM('viewer', 'manager', 'admin');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_users" (
	"slack_user_id" text PRIMARY KEY NOT NULL,
	"email" text,
	"display_name" text,
	"avatar_url" text,
	"role" "user_role" DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_managers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"slack_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "team_managers_team_id_slack_user_id_unique" UNIQUE("team_id","slack_user_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "team_managers" ADD CONSTRAINT "team_managers_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "team_managers" ADD CONSTRAINT "team_managers_slack_user_id_app_users_slack_user_id_fk" FOREIGN KEY ("slack_user_id") REFERENCES "public"."app_users"("slack_user_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
