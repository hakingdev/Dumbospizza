CREATE TABLE "categories" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"image" text DEFAULT '/images/default-category.jpg',
	"icon" text,
	"active" boolean DEFAULT true NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"mews_product_type_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"discount_type" text NOT NULL,
	"discount_value" double precision NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone NOT NULL,
	"min_order_amount" double precision,
	"usage_limit" integer,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_zones" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"min_order_amount" double precision NOT NULL,
	"delivery_fee" double precision NOT NULL,
	"max_distance" double precision NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loyalty_programs" (
	"id" text PRIMARY KEY NOT NULL,
	"user" text NOT NULL,
	"phone_number" text NOT NULL,
	"balance" double precision DEFAULT 0 NOT NULL,
	"total_earned" double precision DEFAULT 0 NOT NULL,
	"total_redeemed" double precision DEFAULT 0 NOT NULL,
	"transactions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "option_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"option_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"min_select" integer DEFAULT 0 NOT NULL,
	"max_select" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "options" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"price" double precision DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"order_number" text,
	"user" text,
	"customer_name" text NOT NULL,
	"phone_number" text NOT NULL,
	"email" text,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"delivery_address" jsonb,
	"delivery_zone" jsonb,
	"delivery_type" text NOT NULL,
	"delivery_fee" double precision DEFAULT 0 NOT NULL,
	"subtotal" double precision NOT NULL,
	"tax" double precision DEFAULT 0 NOT NULL,
	"discount" jsonb,
	"promotion_discount" double precision DEFAULT 0 NOT NULL,
	"promotion_promo_code" text,
	"applied_promotions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"free_gifts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"loyalty_points_used" integer,
	"loyalty_points_earned" integer,
	"total" double precision NOT NULL,
	"payment_method" text NOT NULL,
	"payment_status" text DEFAULT 'pending' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"notes" text,
	"desired_delivery_time" text,
	"telegram_message_id" bigint,
	"mews_order_id" text,
	"kitchen_print_status" text DEFAULT 'pending',
	"customer_print_status" text DEFAULT 'pending',
	"status_updates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"base_price" double precision NOT NULL,
	"image" text DEFAULT '/images/default-product.jpg',
	"available" boolean DEFAULT true NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"valentine_promo" boolean DEFAULT false NOT NULL,
	"tax_rate" double precision DEFAULT 0 NOT NULL,
	"mews_product_id" text,
	"mews_product_type_id" text,
	"mews_sku" text,
	"mews_product_variant_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mews_modifier_set_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"extras" jsonb,
	"option_group_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sizes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promotion_campaign_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"promotion_id" text NOT NULL,
	"channel" text NOT NULL,
	"triggered_by" text DEFAULT 'manual' NOT NULL,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"subject" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promotions" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"internal_name" text,
	"description" text,
	"slug" text NOT NULL,
	"type" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone NOT NULL,
	"scope" text,
	"percent_value" double precision,
	"fixed_value" double precision,
	"min_order_amount" double precision,
	"gratis_trigger" text,
	"gift_product_id" text,
	"gift_product_name" text,
	"gift_product_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bogo_mode" text,
	"target_product_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"target_category_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"target_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reward_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"audience" text DEFAULT 'all' NOT NULL,
	"channel" text DEFAULT 'all' NOT NULL,
	"image" text,
	"banner_image" text,
	"seo_title" text,
	"seo_description" text,
	"og_image" text,
	"badge_text" text,
	"promo_code" text,
	"show_in_modal" boolean DEFAULT true NOT NULL,
	"show_on_offers_page" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"modal_open_count" integer DEFAULT 0 NOT NULL,
	"click_count" integer DEFAULT 0 NOT NULL,
	"order_count" integer DEFAULT 0 NOT NULL,
	"revenue_total" double precision DEFAULT 0 NOT NULL,
	"weekday_schedule_enabled" boolean DEFAULT true NOT NULL,
	"happy_hour_enabled" boolean DEFAULT false NOT NULL,
	"active_days_of_week" jsonb DEFAULT '[0,1,2,3,4,5,6]'::jsonb NOT NULL,
	"active_time_start" text DEFAULT '16:00',
	"active_time_end" text DEFAULT '18:00',
	"schedule_time_zone" text DEFAULT 'Europe/Berlin',
	"auto_notify_on_start" boolean DEFAULT false NOT NULL,
	"last_auto_notify_at" timestamp with time zone,
	"email_campaign_enabled" boolean DEFAULT false NOT NULL,
	"email_subject" text,
	"email_body_html" text,
	"email_sent_at" timestamp with time zone,
	"email_sent_count" integer DEFAULT 0 NOT NULL,
	"push_campaign_enabled" boolean DEFAULT false NOT NULL,
	"push_title" text,
	"push_body" text,
	"push_sent_at" timestamp with time zone,
	"push_sent_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_devices" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"platform" text DEFAULT 'android' NOT NULL,
	"phone_number" text,
	"email" text,
	"active" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "size_variations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone_number" text NOT NULL,
	"password" text,
	"addresses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"role" text DEFAULT 'customer' NOT NULL,
	"password_reset_token" text,
	"password_reset_expires" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_queue" (
	"id" text PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"text" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"order_id" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "categories_slug_uq" ON "categories" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "categories_mews_type_idx" ON "categories" USING btree ("mews_product_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coupons_code_uq" ON "coupons" USING btree ("code");--> statement-breakpoint
CREATE INDEX "delivery_zones_sort_idx" ON "delivery_zones" USING btree ("sort_order","name");--> statement-breakpoint
CREATE UNIQUE INDEX "loyalty_user_uq" ON "loyalty_programs" USING btree ("user");--> statement-breakpoint
CREATE UNIQUE INDEX "loyalty_phone_uq" ON "loyalty_programs" USING btree ("phone_number");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_order_number_uq" ON "orders" USING btree ("order_number");--> statement-breakpoint
CREATE INDEX "orders_phone_idx" ON "orders" USING btree ("phone_number");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "orders_created_idx" ON "orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "orders_mews_order_idx" ON "orders" USING btree ("mews_order_id");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category");--> statement-breakpoint
CREATE INDEX "products_mews_product_idx" ON "products" USING btree ("mews_product_id");--> statement-breakpoint
CREATE INDEX "promo_log_promotion_idx" ON "promotion_campaign_logs" USING btree ("promotion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "promotions_slug_uq" ON "promotions" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "promotions_promo_code_uq" ON "promotions" USING btree ("promo_code") WHERE "promotions"."promo_code" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "promotions_active_idx" ON "promotions" USING btree ("type","enabled","valid_from","valid_to");--> statement-breakpoint
CREATE UNIQUE INDEX "push_devices_token_uq" ON "push_devices" USING btree ("token");--> statement-breakpoint
CREATE INDEX "push_devices_active_platform_idx" ON "push_devices" USING btree ("active","platform");--> statement-breakpoint
CREATE UNIQUE INDEX "settings_key_uq" ON "settings" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email") WHERE "users"."email" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_uq" ON "users" USING btree ("phone_number");--> statement-breakpoint
CREATE INDEX "whatsapp_queue_status_idx" ON "whatsapp_queue" USING btree ("status","created_at");