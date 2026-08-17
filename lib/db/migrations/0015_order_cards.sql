CREATE TABLE "order_cards" (
	"order_id" text PRIMARY KEY NOT NULL,
	"order_number" text NOT NULL,
	"chat_id" text NOT NULL,
	"message_id" bigint NOT NULL,
	"topic_id" integer NOT NULL,
	"status" text NOT NULL,
	"courier" text,
	"status_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "order_cards_order_number_uq" ON "order_cards" USING btree ("order_number");--> statement-breakpoint
CREATE INDEX "order_cards_status_idx" ON "order_cards" USING btree ("status");