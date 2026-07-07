CREATE TABLE IF NOT EXISTS "integration_secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"label" text,
	"secret_ciphertext" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integration_secrets_provider" ON "integration_secrets" ("provider");--> statement-breakpoint
-- Migrate the existing single signing secret into the multi-secret table so current webhooks keep verifying.
INSERT INTO "integration_secrets" ("provider", "label", "secret_ciphertext")
SELECT "provider", 'Webhook secret', "secret_ciphertext"
FROM "integration_settings"
WHERE "secret_ciphertext" IS NOT NULL;
