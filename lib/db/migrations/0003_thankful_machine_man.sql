CREATE TABLE "customer_notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"link_label" text,
	"category" text DEFAULT 'system' NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"campaign_id" text,
	"audience" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "cust_notif_user_read_idx" ON "customer_notifications" USING btree ("user","read","created_at");--> statement-breakpoint
CREATE INDEX "cust_notif_campaign_idx" ON "customer_notifications" USING btree ("campaign_id");