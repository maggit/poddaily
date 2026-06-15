CREATE TABLE IF NOT EXISTS "slack_user_tokens" (
	"slack_user_id" text PRIMARY KEY NOT NULL,
	"access_token" text NOT NULL,
	"scopes" text NOT NULL,
	"authed_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "standup_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"slack_user_id" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now(),
	"type" text DEFAULT 'initial'
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "standup_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"slack_user_id" text NOT NULL,
	"slack_display_name" text NOT NULL,
	"answers" jsonb NOT NULL,
	"status" text DEFAULT 'in_progress',
	"dm_thread_ts" text,
	"channel_post_ts" text,
	"reported_at" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "standup_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"standup_id" uuid,
	"scheduled_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"status" text DEFAULT 'pending',
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "standups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid,
	"name" text DEFAULT 'Daily Standup' NOT NULL,
	"questions" jsonb NOT NULL,
	"schedule_cron" text NOT NULL,
	"schedule_tz" text DEFAULT 'America/Mexico_City' NOT NULL,
	"intro_message" text,
	"outro_message" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "standups_team_id_unique" UNIQUE("team_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid,
	"slack_user_id" text NOT NULL,
	"slack_display_name" text NOT NULL,
	"slack_avatar_url" text,
	"timezone" text,
	"can_report" boolean DEFAULT true,
	"can_view" boolean DEFAULT true,
	"can_edit" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "team_members_team_id_slack_user_id_unique" UNIQUE("team_id","slack_user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slack_channel_id" text NOT NULL,
	"slack_channel_name" text NOT NULL,
	"tribe" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "teams_slack_channel_id_unique" UNIQUE("slack_channel_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "standup_reminders" ADD CONSTRAINT "standup_reminders_run_id_standup_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."standup_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "standup_reports" ADD CONSTRAINT "standup_reports_run_id_standup_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."standup_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "standup_runs" ADD CONSTRAINT "standup_runs_standup_id_standups_id_fk" FOREIGN KEY ("standup_id") REFERENCES "public"."standups"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "standups" ADD CONSTRAINT "standups_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
