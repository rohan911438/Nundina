import { z } from "zod";

const bool = z.preprocess((v) => v === "true" || v === "1", z.boolean());

const Env = z.object({
  API_URL: z.string().default("http://localhost:8787"),
  INTERNAL_SECRET: z.string().min(16),
  CHAIN_ID: z.coerce.number().default(31337),
  RPC_URL: z.string().optional(),
  LOCAL_RPC_URL: z.string().optional(),
  HSK_TESTNET_RPC_URL: z.string().optional(),
  /** Kill switch for every agent process. */
  AGENTS_DISABLED: bool.default(false),
  ANTHROPIC_API_KEY: z.string().optional(),
  BINANCE_URL: z.string().default("https://api.binance.com"),
  BINANCE_FUTURES_URL: z.string().default("https://fapi.binance.com"),
  NEWS_FEEDS: z
    .string()
    .default("https://cointelegraph.com/rss,https://www.coindesk.com/arc/outboundfeeds/rss/,https://decrypt.co/feed,https://bitcoinmagazine.com/.rss/full/"),
  /** Bond each strategy agent keeps deposited (USD). */
  AGENT_BOND_USD: z.string().default("20"),
  /** Execution loop period. */
  EXECUTION_INTERVAL_S: z.coerce.number().default(60),
});
export type AgentEnv = z.infer<typeof Env>;

let cached: AgentEnv | undefined;
export function env(): AgentEnv {
  return (cached ??= Env.parse(process.env));
}
export function resetEnv() {
  cached = undefined;
}
