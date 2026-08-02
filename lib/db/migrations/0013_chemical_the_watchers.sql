ALTER TABLE "orders" ADD COLUMN "eta_minutes" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "eta_set_at" timestamp with time zone;