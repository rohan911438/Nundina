import { z } from "zod";

const optional = z.preprocess((v) => (v === "" ? undefined : v), z.string().optional());
const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  CHAIN_ID: z.coerce.number().default(31337),
  HSK_RPC_URL: z.string().default("https://mainnet.hsk.xyz"),
  HSK_TESTNET_RPC_URL: z.string().default("https://testnet.hsk.xyz"),
  LOCAL_RPC_URL: z.string().default("http://127.0.0.1:8545"),
  KEEPER_PRIVATE_KEY: hex32,
  API_URL: z.string().default("http://127.0.0.1:8787"),
  INTERNAL_SECRET: z.string().min(16),
  KEEPER_PORT: z.coerce.number().default(8790),
  /** /health turns red below this balance (HSK). */
  KEEPER_MIN_BALANCE_HSK: z.coerce.number().default(5),
  /** Max fee per gas the keeper will pay (gwei). */
  KEEPER_MAX_GWEI: z.coerce.number().default(50),
  /** Mock oracle only (local/testnet): seconds between pushed price rounds. */
  KEEPER_PUSH_INTERVAL_S: z.coerce.number().default(120),
  /** Supra pull service (mainnet touch/expiry proofs). TODO(confirm): request format, see contracts/ORACLES.md. */
  SUPRA_PROOF_API_URL: optional,
});
export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;
export function env(): Env {
  cached ??= EnvSchema.parse(process.env);
  return cached;
}

export function rpcUrl(e: Env) {
  if (e.CHAIN_ID === 177) return e.HSK_RPC_URL;
  if (e.CHAIN_ID === 31337) return e.LOCAL_RPC_URL;
  return e.HSK_TESTNET_RPC_URL;
}
