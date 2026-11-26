-- Module H «Push»: opt-in for promo pushes + campaigns + Expo tickets.
-- Applied by hand (drizzle journal is out of sync with prod, see docs/push-notifications.md).
ALTER TABLE "push_devices" ADD COLUMN IF NOT EXISTS "promo_opt_in" boolean DEFAULT false NOT NULL;
ALTER TABLE "push_devices" ADD COLUMN IF NOT EXISTS "locale" text;
ALTER TABLE "push_devices" ADD COLUMN IF NOT EXISTS "app_version" text;

CREATE TABLE IF NOT EXISTS "push_campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"image_url" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"audience" text DEFAULT 'all' NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"accepted_count" integer DEFAULT 0 NOT NULL,
	"delivered_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "push_campaigns_status_scheduled_idx" ON "push_campaigns" USING btree ("status","scheduled_at");

CREATE TABLE IF NOT EXISTS "push_tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"token" text NOT NULL,
	"ticket_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "push_tickets_campaign_idx" ON "push_tickets" USING btree ("campaign_id");
CREATE INDEX IF NOT EXISTS "push_tickets_pending_idx" ON "push_tickets" USING btree ("created_at") WHERE "push_tickets"."status" = 'pending';
