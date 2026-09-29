ALTER TABLE "office_connector" ADD COLUMN "pms_type" text DEFAULT 'denticon' NOT NULL;--> statement-breakpoint
ALTER TABLE "office_connector" ADD COLUMN "mapping" text DEFAULT '{}' NOT NULL;