CREATE TABLE "indexer_cursor" (
	"name" text PRIMARY KEY NOT NULL,
	"block_number" bigint DEFAULT 0 NOT NULL,
	"log_index" integer DEFAULT -1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "touch_json" jsonb;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "commit_block" bigint;