import { z } from "zod";

const bool = z.preprocess((v) => v === "true" || v === "1", z.boolean());

const Env = z.object({
  API_URL: z.string().default("http://localhost:8787"),
  /** Public base URL of this server (agent card, x402 resource ids). */
  MCP_PUBLIC_URL: z.string().default("http://localhost:8791"),
  MCP_PORT: z.coerce.number().default(8791),
  WEB_ORIGIN: z.string().default("https://nundina.xyz"),
  CHAIN_ID: z.coerce.number().default(31337),
  RPC_URL: z.string().optional(),
  LOCAL_RPC_URL: z.string().optional(),
  HSK_TESTNET_RPC_URL: z.string().optional(),
  HSK_RPC_URL: z.string().optional(),
  /** Price of `verify_track_record`, 6-dec units (10000 = 0.01 USDC.e). */
  VERIFY_PRICE_UNITS: z.coerce.bigint().default(10_000n),
  /** x402 facilitator (HSP). Unset → payment-required errors point to prepaid credits. */
  HSP_FACILITATOR_URL: z.string().optional(),
  /** Where x402 payments for data tools go. */
  MCP_PAY_TO: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  /** stdio mode: the agent API key to act with. */
  NUNDINA_API_KEY: z.string().optional(),
  /** Custodial demo mode (testnet/local only): the server pays from a scoped demo agent. */
  MCP_CUSTODIAL: bool.default(false),
  MCP_DEMO_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  MCP_DEMO_MAX_PER_SIGNAL_UNITS: z.coerce.bigint().default(500_000n),
  MCP_DEMO_DAILY_UNITS: z.coerce.bigint().default(2_000_000n),
  INTERNAL_SECRET: z.string().optional(),
});
export type McpEnv = z.infer<typeof Env>;

let cached: McpEnv | undefined;
export const env = () => (cached ??= Env.parse(process.env));
export const resetEnv = () => {
  cached = undefined;
};
