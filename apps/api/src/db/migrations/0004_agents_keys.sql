ALTER TABLE "agents" ADD COLUMN "wallet_key_enc" "bytea";--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "enc_key_enc" "bytea";--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "enc_pubkey" text;