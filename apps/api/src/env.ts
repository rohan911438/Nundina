import { z } from "zod";

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const optionalHex32 = z.preprocess((v) => (v === "" ? undefined : v), hex32.optional());
const optional = z.preprocess((v) => (v === "" ? undefined : v), z.string().optional());

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(8787),
  PUBLIC_API_URL: z.string().default("http://localhost:8787"),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  DATABASE_URL: z.string().default("postgres://nundina:nundina@localhost:5432/nundina"),

  CHAIN_ID: z.coerce.number().default(31337),
  HSK_RPC_URL: z.string().default("https://mainnet.hsk.xyz"),
  HSK_TESTNET_RPC_URL: z.string().default("https://testnet.hsk.xyz"),
  LOCAL_RPC_URL: z.string().default("http://127.0.0.1:8545"),
  RELAYER_PRIVATE_KEY: optionalHex32,
  CREDIT_SIGNER_PRIVATE_KEY: optionalHex32,
  /** Minimum relayer balance (wei) before it refuses to send. Default 0.05 HSK. */
  RELAYER_MIN_BALANCE_WEI: z.coerce.bigint().default(50_000_000_000_000_000n),

  KEY_SERVICE_MASTER_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, "32-byte hex"),
  /** Previous master key during rotation (rows sealed with it still open). */
  KEY_SERVICE_MASTER_KEY_PREVIOUS: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^[0-9a-fA-F]{64}$/).optional()),
  INTERNAL_SECRET: z.string().min(16),
  SESSION_SECRET: optional,
  TELEGRAM_BOT_TOKEN: optional,

  HSP_MODE: z.enum(["mock", "live"]).default("mock"),
  HSP_COORDINATOR_URL: optional,
  HSP_API_KEY: optional,
  HSP_CHAIN: optional,
  HSP_ADAPTER_ADDRESS: optional,
  HSP_FACILITATOR_URL: optional,
  /** Base URL of the HSP explorer (defaults to <coordinator>/explorer). */
  HSP_EXPLORER_URL: optional,
  /** Mock rail adapter key (signs receipts); defaults to a key derived from INTERNAL_SECRET. */
  MOCK_ADAPTER_PRIVATE_KEY: optionalHex32,
  /** USDC.e EIP-3009 one-transaction purchase path. */
  FAST_PATH_ENABLED: z.preprocess((v) => v === "true" || v === "1", z.boolean()).default(false),
  /** Start pg-boss workers in this process (hsp.verify, signal.reveal). */
  RUN_WORKERS: z.preprocess((v) => v !== "false" && v !== "0", z.boolean()).default(true),

  ANTHROPIC_API_KEY: optional,
  LOG_LEVEL: z.string().default("info"),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

/** Parses process.env once. Throws with a readable message on bad config. */
export function env(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${msg}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: reset the cached env after mutating process.env. */
export function resetEnv() {
  cached = undefined;
}

export function rpcUrl(e: Env = env()): string {
  if (e.CHAIN_ID === 177) return e.HSK_RPC_URL;
  if (e.CHAIN_ID === 31337) return e.LOCAL_RPC_URL;
  return e.HSK_TESTNET_RPC_URL;
}

export function sessionSecret(e: Env = env()): string {
  return e.SESSION_SECRET ?? `${e.INTERNAL_SECRET}:session`;
}
