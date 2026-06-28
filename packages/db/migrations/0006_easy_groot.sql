CREATE TABLE IF NOT EXISTS "slack_directory_users" (
	"slack_user_id" text PRIMARY KEY NOT NULL,
	"display_name" text,
	"real_name" text,
	"email" text,
	"avatar_url" text,
	"tz" text,
	"is_bot" boolean DEFAULT false NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
-- Trigram search support for fast, typo-tolerant name/email autocomplete.
-- The GIN index accelerates `ILIKE '%q%'` over the combined searchable text; it is
-- managed out-of-band (Drizzle can't express an expression index), so future
-- `drizzle-kit generate` runs leave it untouched.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "slack_directory_users_search_trgm" ON "slack_directory_users"
	USING gin ((lower(coalesce("display_name", '') || ' ' || coalesce("real_name", '') || ' ' || coalesce("email", ''))) gin_trgm_ops);
