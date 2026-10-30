import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** bytea as Uint8Array. */
const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => "bytea",
  toDriver: (v) => Buffer.from(v),
  fromDriver: (v) => new Uint8Array(v),
});

/** Money / price in base units, never floats. Read back as string. */
const units = (name: string) => numeric(name, { precision: 38, scale: 0 });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow();

// ───────────────────────── the 12 product tables (see docs/ARCHITECTURE.md) ─────────────────────────

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  wallet: text("wallet").unique(), // lower-case 0x address
  telegramId: bigint("telegram_id", { mode: "number" }).unique(),
  telegramUsername: text("telegram_username"),
  /** secp256k1 public key (compressed hex) used to ECIES-wrap signal keys for this buyer. */
  pubkey: text("pubkey"),
  createdAt: createdAt(),
});

export const providers = pgTable(
  "providers",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => users.id),
    handle: text("handle").notNull().unique(),
    displayName: text("display_name").notNull(),
    bio: text("bio"),
    avatarUrl: text("avatar_url"),
    /** On-chain provider address (signs commits). */
    address: text("address").notNull().unique(),
    erc8004Id: units("erc8004_id"),
    payoutAddr: text("payout_addr").notNull(),
    channelId: bigint("channel_id", { mode: "number" }).unique(),
    channelTitle: text("channel_title"),
    /** Public @username of the channel (null for private ones), shown so buyers can check it is the real one. */
    channelUsername: text("channel_username"),
    channelMembers: integer("channel_members"),
    /** The provider's own Telegram role in the channel when last verified: creator | administrator. */
    channelRole: text("channel_role"),
    /** Last time the bot confirmed it is still admin there and the provider still owns or admins it. */
    channelVerifiedAt: ts("channel_verified_at"),
    /** Handle of an established provider whose channel or name this one closely resembles (impersonation warning). */
    lookalikeOf: text("lookalike_of"),
    kycUntil: ts("kyc_until"),
    isAgent: boolean("is_agent").notNull().default(false),
    /** human | agent | aggregator */
    kind: text("kind").notNull().default("human"),
    isPractice: boolean("is_practice").notNull().default(false),
    defaultPrice: units("default_price").notNull().default("1000000"),
    defaultValidityHours: integer("default_validity_hours").notNull().default(24),
    /** Pay-if-works pricing; only allowed once the provider is out of probation (≥ 30 settled). */
    payIfWorks: boolean("pay_if_works").notNull().default(false),
    bondToken: text("bond_token"),
    bondTotal: units("bond_total").notNull().default("0"),
    bondLocked: units("bond_locked").notNull().default("0"),
    registeredOnChain: boolean("registered_on_chain").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("providers_channel_idx").on(t.channelId)],
);

export const signalDrafts = pgTable(
  "signal_drafts",
  {
    id: serial("id").primaryKey(),
    providerId: integer("provider_id")
      .notNull()
      .references(() => providers.id),
    rawText: text("raw_text").notNull(),
    parsedJson: jsonb("parsed_json"),
    /** rules | llm | manual | agent */
    parser: text("parser").notNull().default("manual"),
    /** pending | prepared | committed | rejected | failed | expired */
    status: text("status").notNull().default("pending"),
    /** Full signal (without salt) frozen at prepare time. */
    signalJson: jsonb("signal_json"),
    saltEnc: bytea("salt_enc"),
    commitHash: text("commit_hash"),
    signalId: bigint("signal_id", { mode: "bigint" }),
    sourceChatId: bigint("source_chat_id", { mode: "number" }),
    sourceMessageId: bigint("source_message_id", { mode: "number" }),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("drafts_provider_idx").on(t.providerId, t.status)],
);

export const signals = pgTable(
  "signals",
  {
    /** On-chain signal id. */
    id: bigint("id", { mode: "bigint" }).primaryKey(),
    providerId: integer("provider_id")
      .notNull()
      .references(() => providers.id),
    commitHash: text("commit_hash").notNull().unique(),
    market: text("market").notNull(), // label, e.g. BTC/USD
    marketId: text("market_id").notNull(), // bytes32
    // plaintext fields are NULL until reveal
    side: smallint("side"),
    entry: units("entry"),
    tp: units("tp"),
    sl: units("sl"),
    validUntil: ts("valid_until").notNull(),
    committedAt: ts("committed_at").notNull(),
    price: units("price").notNull(),
    oraclePrice: units("oracle_price"),
    isLimit: boolean("is_limit"),
    cipherUri: text("cipher_uri"),
    ciphertext: bytea("ciphertext"),
    aesKeyEnc: bytea("aes_key_enc"),
    saltEnc: bytea("salt_enc"),
    /** COMMITTED | REVEALED | TOUCH_PENDING | RESOLVED | SETTLED | UNREVEALED_LOSS | REFUNDED */
    status: text("status").notNull().default("COMMITTED"),
    /** WIN | LOSS | VOID */
    outcome: text("outcome"),
    rMultiple: numeric("r_multiple", { precision: 10, scale: 2 }),
    upstreamJson: jsonb("upstream_json").$type<{ id: string; bps: number }[]>().notNull().default([]),
    commitTx: text("commit_tx"),
    revealTx: text("reveal_tx"),
    resolveTx: text("resolve_tx"),
    /** Proven touch / pending expiry from the resolver: { level, price, ts, tx } */
    touchJson: jsonb("touch_json"),
    /** Block of the SignalCommitted event (filled by the indexer). */
    commitBlock: bigint("commit_block", { mode: "number" }),
    revealedAt: ts("revealed_at"),
    decidedAt: ts("decided_at"),
    purchaseCount: integer("purchase_count").notNull().default(0),
    tgChatId: bigint("tg_chat_id", { mode: "number" }),
    tgMessageId: bigint("tg_message_id", { mode: "number" }),
    /** The bot's locked card, posted as a reply to the source post; result cards reply to it. */
    tgCardMessageId: bigint("tg_card_message_id", { mode: "number" }),
    /** chain | seed */
    source: text("source").notNull().default("chain"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("signals_provider_status_idx").on(t.providerId, t.status),
    index("signals_valid_until_idx").on(t.validUntil),
    index("signals_committed_idx").on(t.committedAt),
  ],
);

export const purchases = pgTable(
  "purchases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    signalId: bigint("signal_id", { mode: "bigint" })
      .notNull()
      .references(() => signals.id),
    buyerUserId: integer("buyer_user_id").references(() => users.id),
    agentId: integer("agent_id"),
    buyerAddress: text("buyer_address").notNull(),
    amount: units("amount").notNull(),
    token: text("token").notNull(),
    /** hsp | eip3009 */
    rail: text("rail").notNull().default("hsp"),
    hspPaymentId: text("hsp_payment_id"),
    mandateJson: jsonb("mandate_json"),
    receiptHash: text("receipt_hash"),
    txHash: text("tx_hash"),
    /** ACCEPT | REJECT | RETRYABLE */
    outcomeClass: text("outcome_class"),
    creditedTx: text("credited_tx"),
    /** HSP explorer link (or the chain explorer for the direct rail). */
    explorerUrl: text("explorer_url"),
    /** recoverUncredited tx when a rejected transfer was returned to the payer. */
    recoveryTx: text("recovery_tx"),
    rejectReason: text("reject_reason"),
    /** PENDING | SUBMITTED | CREDITED | KEY_SENT | SETTLED_WIN | REFUNDED | REJECTED | FAILED_RETRYABLE */
    status: text("status").notNull().default("PENDING"),
    idempotencyKey: text("idempotency_key"),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("purchases_signal_idx").on(t.signalId),
    index("purchases_buyer_idx").on(t.buyerUserId),
    uniqueIndex("purchases_hsp_payment_idx").on(t.hspPaymentId),
    uniqueIndex("purchases_signal_buyer_idx").on(t.signalId, t.buyerAddress),
  ],
);

export const keyDeliveries = pgTable("key_deliveries", {
  purchaseId: uuid("purchase_id")
    .primaryKey()
    .references(() => purchases.id),
  wrappedKey: text("wrapped_key").notNull(),
  /** web | telegram | api */
  channel: text("channel").notNull().default("web"),
  deliveredAt: ts("delivered_at"),
  createdAt: createdAt(),
});

export const settlements = pgTable("settlements", {
  signalId: bigint("signal_id", { mode: "bigint" })
    .primaryKey()
    .references(() => signals.id),
  outcome: text("outcome").notNull(),
  proofTx: text("proof_tx"),
  settleTx: text("settle_tx"),
  payout: units("payout").notNull().default("0"),
  refundsTotal: units("refunds_total").notNull().default("0"),
  slashTotal: units("slash_total").notNull().default("0"),
  fee: units("fee").notNull().default("0"),
  settledAt: ts("settled_at").notNull().defaultNow(),
});

export const providerScores = pgTable(
  "provider_scores",
  {
    providerId: integer("provider_id")
      .notNull()
      .references(() => providers.id),
    /** 7d | 30d | all */
    period: text("period").notNull(),
    /** all | BTC/USD | HSK/USD */
    market: text("market").notNull().default("all"),
    n: integer("n").notNull().default(0),
    wins: integer("wins").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    voids: integer("voids").notNull().default(0),
    winRate: numeric("win_rate", { precision: 8, scale: 4 }).notNull().default("0"),
    wilsonLb: numeric("wilson_lb", { precision: 8, scale: 4 }).notNull().default("0"),
    expectancyR: numeric("expectancy_r", { precision: 10, scale: 4 }).notNull().default("0"),
    alphaBtc: numeric("alpha_btc", { precision: 10, scale: 4 }).notNull().default("0"),
    maxDd: numeric("max_dd", { precision: 10, scale: 4 }).notNull().default("0"),
    followerPnl: numeric("follower_pnl", { precision: 20, scale: 2 }).notNull().default("0"),
    score: numeric("score", { precision: 8, scale: 2 }).notNull().default("0"),
    ranked: boolean("ranked").notNull().default(false),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.providerId, t.period, t.market] }), index("scores_period_idx").on(t.period, t.score)],
);

export const agents = pgTable("agents", {
  id: serial("id").primaryKey(),
  ownerUserId: integer("owner_user_id").references(() => users.id),
  providerId: integer("provider_id").references(() => providers.id),
  name: text("name").notNull(),
  wallet: text("wallet"),
  /** Agent wallet private key, sealed with the master key (user-created execution agents). */
  walletKeyEnc: bytea("wallet_key_enc"),
  /** Agent encryption key pair (private sealed). Keys for agent purchases are wrapped to `encPubkey`. */
  encKeyEnc: bytea("enc_key_enc"),
  encPubkey: text("enc_pubkey"),
  /** execution | strategy | aggregator */
  type: text("type").notNull(),
  policyJson: jsonb("policy_json").$type<AgentPolicy>().notNull().default({} as AgentPolicy),
  paused: boolean("paused").notNull().default(false),
  spentToday: units("spent_today").notNull().default("0"),
  spentDay: date("spent_day"),
  /** Prepaid credit for paid MCP data tools (6-dec units). */
  credits: units("credits").notNull().default("0"),
  createdAt: createdAt(),
});

export interface AgentPolicy {
  dailyBudget?: string; // 6-dec units
  maxPerSignal?: string;
  minScore?: number;
  markets?: string[];
  /** Provider handles; empty = any. */
  providersAllow?: string[];
  providersDeny?: string[];
  autoTrade?: boolean;
  slippageBps?: number;
}

export const agentActions = pgTable(
  "agent_actions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    agentId: integer("agent_id")
      .notNull()
      .references(() => agents.id),
    signalId: bigint("signal_id", { mode: "bigint" }),
    /** buy | skip | post | trade | error */
    decision: text("decision").notNull(),
    reason: text("reason"),
    purchaseId: uuid("purchase_id"),
    fillJson: jsonb("fill_json"),
    createdAt: createdAt(),
  },
  (t) => [index("agent_actions_agent_idx").on(t.agentId, t.createdAt)],
);

export const shadowChannels = pgTable("shadow_channels", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  title: text("title"),
  optedOut: boolean("opted_out").notNull().default(false),
  lastScrapedAt: ts("last_scraped_at"),
  createdAt: createdAt(),
});

export const shadowCalls = pgTable("shadow_calls", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  channelId: integer("channel_id")
    .notNull()
    .references(() => shadowChannels.id),
  messageId: bigint("message_id", { mode: "number" }).notNull(),
  postedAt: ts("posted_at").notNull(),
  rawText: text("raw_text").notNull(),
  parsedJson: jsonb("parsed_json"),
  outcome: text("outcome"),
  rMultiple: numeric("r_multiple", { precision: 10, scale: 2 }),
  createdAt: createdAt(),
});

// ───────────────────────── supporting tables ─────────────────────────

/** Every transaction the relayer sends (idempotent by key). */
export const relayedTxs = pgTable(
  "relayed_txs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    purpose: text("purpose").notNull(),
    chainId: integer("chain_id").notNull(),
    from: text("from_addr").notNull(),
    to: text("to_addr").notNull(),
    data: text("data").notNull(),
    nonce: integer("nonce"),
    hash: text("hash"),
    /** queued | sent | mined | failed */
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    gasPrice: units("gas_price"),
    blockNumber: bigint("block_number", { mode: "number" }),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("relayed_status_idx").on(t.status)],
);

export const authNonces = pgTable("auth_nonces", {
  nonce: text("nonce").primaryKey(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
});

export const apiKeys = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  keyHash: text("key_hash").notNull().unique(),
  prefix: text("prefix").notNull(),
  ownerUserId: integer("owner_user_id").references(() => users.id),
  agentId: integer("agent_id").references(() => agents.id),
  label: text("label"),
  revokedAt: ts("revoked_at"),
  createdAt: createdAt(),
});

export const telegramLinkCodes = pgTable("telegram_link_codes", {
  code: text("code").primaryKey(),
  providerId: integer("provider_id")
    .notNull()
    .references(() => providers.id),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
});

/**
 * One-time tokens that tie a Telegram account to a wallet account: made on the web (userId set,
 * redeemed by `/start acct_<token>` in the bot) or in the bot (telegramId set, redeemed on the web).
 */
export const telegramAccountLinks = pgTable("telegram_account_links", {
  token: text("token").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  telegramId: bigint("telegram_id", { mode: "number" }),
  telegramUsername: text("telegram_username"),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
});

export const priceCandles = pgTable(
  "price_candles",
  {
    market: text("market").notNull(),
    interval: text("interval").notNull(),
    openTime: ts("open_time").notNull(),
    open: numeric("open", { precision: 24, scale: 8 }).notNull(),
    high: numeric("high", { precision: 24, scale: 8 }).notNull(),
    low: numeric("low", { precision: 24, scale: 8 }).notNull(),
    close: numeric("close", { precision: 24, scale: 8 }).notNull(),
    volume: numeric("volume", { precision: 30, scale: 8 }).notNull().default("0"),
  },
  (t) => [primaryKey({ columns: [t.market, t.interval, t.openTime] })],
);

/** Payment-rail records (mandate, settlement tx, receipt); one row per HSP paymentId. */
export const railPayments = pgTable("rail_payments", {
  /** HSP paymentId = mandateHash. */
  id: text("id").primaryKey(),
  /** mock | hsp */
  rail: text("rail").notNull(),
  mandateJson: jsonb("mandate_json").notNull(),
  mandateSig: text("mandate_sig"),
  txHash: text("tx_hash").unique(),
  /** CREATED | SUBMITTED | VERIFIED | REJECTED */
  status: text("status").notNull().default("CREATED"),
  outcomeClass: text("outcome_class"),
  receiptJson: jsonb("receipt_json"),
  receiptHash: text("receipt_hash"),
  adapterSig: text("adapter_sig"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Projection cursor of the indexer (apps/indexer/projector/sync.ts). */
export const indexerCursor = pgTable("indexer_cursor", {
  name: text("name").primaryKey(),
  blockNumber: bigint("block_number", { mode: "number" }).notNull().default(0),
  logIndex: integer("log_index").notNull().default(-1),
  updatedAt: updatedAt(),
});

export const now = sql`now()`;

/** grammY session storage (one row per chat/user key). */
export const botSessions = pgTable("bot_sessions", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: updatedAt(),
});
