ALTER TABLE "standup_runs" ADD COLUMN "scheduled_date" date NOT NULL;--> statement-breakpoint
ALTER TABLE "standup_reports" ADD CONSTRAINT "standup_reports_run_id_slack_user_id_unique" UNIQUE("run_id","slack_user_id");--> statement-breakpoint
ALTER TABLE "standup_runs" ADD CONSTRAINT "standup_runs_standup_id_scheduled_date_unique" UNIQUE("standup_id","scheduled_date");