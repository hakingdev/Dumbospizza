CREATE TABLE "loyalty_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"user" text NOT NULL,
	"order" text,
	"type" text NOT NULL,
	"amount" double precision NOT NULL,
	"delta" double precision NOT NULL,
	"balance_after" double precision DEFAULT 0 NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"expires_at" timestamp with time zone,
	"consumed" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "gift_items" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "loyalty_tx_user_idx" ON "loyalty_transactions" USING btree ("user","created_at");--> statement-breakpoint
CREATE INDEX "loyalty_tx_order_type_idx" ON "loyalty_transactions" USING btree ("order","type");--> statement-breakpoint
CREATE INDEX "loyalty_tx_expiry_idx" ON "loyalty_transactions" USING btree ("type","expires_at");