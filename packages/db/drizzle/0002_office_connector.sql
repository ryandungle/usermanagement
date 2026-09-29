CREATE TABLE "office_connector" (
	"office_id" text PRIMARY KEY NOT NULL,
	"type" text DEFAULT 'mongodb' NOT NULL,
	"url_encrypted" text NOT NULL,
	"host" text NOT NULL,
	"database" text NOT NULL,
	"collections" text DEFAULT '[]' NOT NULL,
	"status" text DEFAULT 'unknown' NOT NULL,
	"last_error" text,
	"last_tested_at" timestamp,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "office_connector" ADD CONSTRAINT "office_connector_office_id_office_id_fk" FOREIGN KEY ("office_id") REFERENCES "public"."office"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_connector" ADD CONSTRAINT "office_connector_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;