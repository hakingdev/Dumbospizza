ALTER TABLE "homepage_banners" ADD COLUMN "active_days_of_week" jsonb DEFAULT '[0,1,2,3,4,5,6]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "homepage_banners" ADD COLUMN "schedule_time_zone" text DEFAULT 'Europe/Berlin' NOT NULL;--> statement-breakpoint
ALTER TABLE "homepage_banners" DROP COLUMN IF EXISTS "valid_from";--> statement-breakpoint
ALTER TABLE "homepage_banners" DROP COLUMN IF EXISTS "valid_to";
