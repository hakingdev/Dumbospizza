ALTER TABLE "orders" ADD COLUMN "sms_marketing_consent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "sms_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "sms_consent_text" text;--> statement-breakpoint
CREATE INDEX "orders_sms_consent_idx" ON "orders" USING btree ("sms_marketing_consent");