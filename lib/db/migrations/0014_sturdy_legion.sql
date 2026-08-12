ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "eta_analysis" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'website' NOT NULL;
