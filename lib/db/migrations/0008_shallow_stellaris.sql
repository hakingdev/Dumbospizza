CREATE TABLE "homepage_banners" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"subtitle" text,
	"image" text NOT NULL,
	"link_url" text,
	"badge_text" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "homepage_banners_active_idx" ON "homepage_banners" USING btree ("enabled","order");