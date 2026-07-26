ALTER TABLE "categories" ADD COLUMN "subcategories" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "subcategory_id" text;