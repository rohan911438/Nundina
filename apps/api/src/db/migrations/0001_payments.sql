CREATE TABLE "rail_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"rail" text NOT NULL,
	"mandate_json" jsonb NOT NULL,
	"mandate_sig" text,
	"tx_hash" text,
	"status" text DEFAULT 'CREATED' NOT NULL,
	"outcome_class" text,
	"receipt_json" jsonb,
	"receipt_hash" text,
	"adapter_sig" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rail_payments_tx_hash_unique" UNIQUE("tx_hash")
);
--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "explorer_url" text;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "recovery_tx" text;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "reject_reason" text;