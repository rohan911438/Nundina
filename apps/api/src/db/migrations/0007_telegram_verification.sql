CREATE TABLE "telegram_account_links" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" integer,
	"telegram_id" bigint,
	"telegram_username" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "channel_username" text;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "channel_members" integer;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "channel_role" text;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "channel_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "lookalike_of" text;--> statement-breakpoint
ALTER TABLE "telegram_account_links" ADD CONSTRAINT "telegram_account_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- one channel, one provider: before the constraint, older links win and later duplicates are unlinked
UPDATE "providers" p SET "channel_id" = NULL WHERE "channel_id" IS NOT NULL AND EXISTS (SELECT 1 FROM "providers" q WHERE q."channel_id" = p."channel_id" AND q."id" < p."id");--> statement-breakpoint
ALTER TABLE "providers" ADD CONSTRAINT "providers_channel_id_unique" UNIQUE("channel_id");