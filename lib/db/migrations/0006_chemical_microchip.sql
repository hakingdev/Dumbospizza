CREATE TABLE "email_unsubscribes" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "email_unsubscribes_email_uq" ON "email_unsubscribes" USING btree ("email");