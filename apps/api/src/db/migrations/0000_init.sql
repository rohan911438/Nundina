CREATE TABLE "agent_actions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"signal_id" bigint,
	"decision" text NOT NULL,
	"reason" text,
	"purchase_id" uuid,
	"fill_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_user_id" integer,
	"provider_id" integer,
	"name" text NOT NULL,
	"wallet" text,
	"type" text NOT NULL,
	"policy_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"spent_today" numeric(38, 0) DEFAULT '0' NOT NULL,
	"spent_day" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"key_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"owner_user_id" integer,
	"agent_id" integer,
	"label" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "auth_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "key_deliveries" (
	"purchase_id" uuid PRIMARY KEY NOT NULL,
	"wrapped_key" text NOT NULL,
	"channel" text DEFAULT 'web' NOT NULL,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_candles" (
	"market" text NOT NULL,
	"interval" text NOT NULL,
	"open_time" timestamp with time zone NOT NULL,
	"open" numeric(24, 8) NOT NULL,
	"high" numeric(24, 8) NOT NULL,
	"low" numeric(24, 8) NOT NULL,
	"close" numeric(24, 8) NOT NULL,
	"volume" numeric(30, 8) DEFAULT '0' NOT NULL,
	CONSTRAINT "price_candles_market_interval_open_time_pk" PRIMARY KEY("market","interval","open_time")
);
--> statement-breakpoint
CREATE TABLE "provider_scores" (
	"provider_id" integer NOT NULL,
	"period" text NOT NULL,
	"market" text DEFAULT 'all' NOT NULL,
	"n" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"voids" integer DEFAULT 0 NOT NULL,
	"win_rate" numeric(8, 4) DEFAULT '0' NOT NULL,
	"wilson_lb" numeric(8, 4) DEFAULT '0' NOT NULL,
	"expectancy_r" numeric(10, 4) DEFAULT '0' NOT NULL,
	"alpha_btc" numeric(10, 4) DEFAULT '0' NOT NULL,
	"max_dd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"follower_pnl" numeric(20, 2) DEFAULT '0' NOT NULL,
	"score" numeric(8, 2) DEFAULT '0' NOT NULL,
	"ranked" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_scores_provider_id_period_market_pk" PRIMARY KEY("provider_id","period","market")
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"handle" text NOT NULL,
	"display_name" text NOT NULL,
	"bio" text,
	"avatar_url" text,
	"address" text NOT NULL,
	"erc8004_id" numeric(38, 0),
	"payout_addr" text NOT NULL,
	"channel_id" bigint,
	"channel_title" text,
	"kyc_until" timestamp with time zone,
	"is_agent" boolean DEFAULT false NOT NULL,
	"kind" text DEFAULT 'human' NOT NULL,
	"is_practice" boolean DEFAULT false NOT NULL,
	"default_price" numeric(38, 0) DEFAULT '1000000' NOT NULL,
	"bond_token" text,
	"bond_total" numeric(38, 0) DEFAULT '0' NOT NULL,
	"bond_locked" numeric(38, 0) DEFAULT '0' NOT NULL,
	"registered_on_chain" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "providers_handle_unique" UNIQUE("handle"),
	CONSTRAINT "providers_address_unique" UNIQUE("address")
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_id" bigint NOT NULL,
	"buyer_user_id" integer,
	"agent_id" integer,
	"buyer_address" text NOT NULL,
	"amount" numeric(38, 0) NOT NULL,
	"token" text NOT NULL,
	"rail" text DEFAULT 'hsp' NOT NULL,
	"hsp_payment_id" text,
	"mandate_json" jsonb,
	"receipt_hash" text,
	"tx_hash" text,
	"outcome_class" text,
	"credited_tx" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"idempotency_key" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relayed_txs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"purpose" text NOT NULL,
	"chain_id" integer NOT NULL,
	"from_addr" text NOT NULL,
	"to_addr" text NOT NULL,
	"data" text NOT NULL,
	"nonce" integer,
	"hash" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"gas_price" numeric(38, 0),
	"block_number" bigint,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relayed_txs_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"signal_id" bigint PRIMARY KEY NOT NULL,
	"outcome" text NOT NULL,
	"proof_tx" text,
	"settle_tx" text,
	"payout" numeric(38, 0) DEFAULT '0' NOT NULL,
	"refunds_total" numeric(38, 0) DEFAULT '0' NOT NULL,
	"slash_total" numeric(38, 0) DEFAULT '0' NOT NULL,
	"fee" numeric(38, 0) DEFAULT '0' NOT NULL,
	"settled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shadow_calls" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"channel_id" integer NOT NULL,
	"message_id" bigint NOT NULL,
	"posted_at" timestamp with time zone NOT NULL,
	"raw_text" text NOT NULL,
	"parsed_json" jsonb,
	"outcome" text,
	"r_multiple" numeric(10, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shadow_channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"title" text,
	"opted_out" boolean DEFAULT false NOT NULL,
	"last_scraped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shadow_channels_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "signal_drafts" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_id" integer NOT NULL,
	"raw_text" text NOT NULL,
	"parsed_json" jsonb,
	"parser" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"signal_json" jsonb,
	"salt_enc" "bytea",
	"commit_hash" text,
	"signal_id" bigint,
	"source_chat_id" bigint,
	"source_message_id" bigint,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"id" bigint PRIMARY KEY NOT NULL,
	"provider_id" integer NOT NULL,
	"commit_hash" text NOT NULL,
	"market" text NOT NULL,
	"market_id" text NOT NULL,
	"side" smallint,
	"entry" numeric(38, 0),
	"tp" numeric(38, 0),
	"sl" numeric(38, 0),
	"valid_until" timestamp with time zone NOT NULL,
	"committed_at" timestamp with time zone NOT NULL,
	"price" numeric(38, 0) NOT NULL,
	"oracle_price" numeric(38, 0),
	"is_limit" boolean,
	"cipher_uri" text,
	"ciphertext" "bytea",
	"aes_key_enc" "bytea",
	"salt_enc" "bytea",
	"status" text DEFAULT 'COMMITTED' NOT NULL,
	"outcome" text,
	"r_multiple" numeric(10, 2),
	"upstream_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"commit_tx" text,
	"reveal_tx" text,
	"resolve_tx" text,
	"revealed_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"purchase_count" integer DEFAULT 0 NOT NULL,
	"tg_chat_id" bigint,
	"tg_message_id" bigint,
	"source" text DEFAULT 'chain' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signals_commit_hash_unique" UNIQUE("commit_hash")
);
--> statement-breakpoint
CREATE TABLE "telegram_link_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"provider_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"wallet" text,
	"telegram_id" bigint,
	"telegram_username" text,
	"pubkey" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_wallet_unique" UNIQUE("wallet"),
	CONSTRAINT "users_telegram_id_unique" UNIQUE("telegram_id")
);
--> statement-breakpoint
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "key_deliveries" ADD CONSTRAINT "key_deliveries_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_scores" ADD CONSTRAINT "provider_scores_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "providers" ADD CONSTRAINT "providers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_buyer_user_id_users_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shadow_calls" ADD CONSTRAINT "shadow_calls_channel_id_shadow_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."shadow_channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_drafts" ADD CONSTRAINT "signal_drafts_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_link_codes" ADD CONSTRAINT "telegram_link_codes_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_actions_agent_idx" ON "agent_actions" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "scores_period_idx" ON "provider_scores" USING btree ("period","score");--> statement-breakpoint
CREATE INDEX "providers_channel_idx" ON "providers" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "purchases_signal_idx" ON "purchases" USING btree ("signal_id");--> statement-breakpoint
CREATE INDEX "purchases_buyer_idx" ON "purchases" USING btree ("buyer_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchases_hsp_payment_idx" ON "purchases" USING btree ("hsp_payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchases_signal_buyer_idx" ON "purchases" USING btree ("signal_id","buyer_address");--> statement-breakpoint
CREATE INDEX "relayed_status_idx" ON "relayed_txs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "drafts_provider_idx" ON "signal_drafts" USING btree ("provider_id","status");--> statement-breakpoint
CREATE INDEX "signals_provider_status_idx" ON "signals" USING btree ("provider_id","status");--> statement-breakpoint
CREATE INDEX "signals_valid_until_idx" ON "signals" USING btree ("valid_until");--> statement-breakpoint
CREATE INDEX "signals_committed_idx" ON "signals" USING btree ("committed_at");