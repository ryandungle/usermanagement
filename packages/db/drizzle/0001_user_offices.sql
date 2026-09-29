CREATE TABLE "user_office" (
	"user_id" text NOT NULL,
	"office_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_office_user_id_office_id_pk" PRIMARY KEY("user_id","office_id")
);
--> statement-breakpoint
ALTER TABLE "user" DROP CONSTRAINT "user_office_id_office_id_fk";
--> statement-breakpoint
DROP INDEX "user_office_id_idx";--> statement-breakpoint
ALTER TABLE "user_office" ADD CONSTRAINT "user_office_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_office" ADD CONSTRAINT "user_office_office_id_office_id_fk" FOREIGN KEY ("office_id") REFERENCES "public"."office"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_office_office_id_idx" ON "user_office" USING btree ("office_id");--> statement-breakpoint
INSERT INTO "user_office" ("user_id", "office_id") SELECT "id", "office_id" FROM "user" WHERE "office_id" IS NOT NULL ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "office_id";