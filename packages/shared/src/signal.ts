import { hashTypedData, keccak256, toBytes, isAddress, type Address, type Hex } from "viem";
import { z } from "zod";
import { Side } from "./enums";
import { EXTERNAL } from "./addresses";
import { COMMIT_AUTH_TYPES, SIGNAL_TYPES, nundinaDomain } from "./eip712";

export interface Signal {
  provider: Address;
  market: Hex;
  side: Side;
  entry: bigint; // 8 decimals
  takeProfit: bigint; // 8 decimals
  stopLoss: bigint; // 8 decimals
  validUntil: bigint; // unix seconds
  pricePerSub: bigint; // 6 decimals
  upstream: bigint[];
  upstreamBps: number[];
  salt: Hex;
}

export interface CommitAuthorization {
  provider: Address;
  commitHash: Hex;
  market: Hex;
  validUntil: bigint;
  pricePerSub: bigint;
  nonce: bigint;
  deadline: bigint;
}

export const marketId = (label: string) => keccak256(toBytes(label));

export interface MarketInfo {
  id: Hex;
  label: string;
  base: string;
  aproFeed: Address;
  supraPairId: number | null;
  /** Off-chain price stream used for charts and early touch detection. */
  cex: { venue: "binance" | "gate"; symbol: string; ws: string };
  /** Display decimals for prices. */
  displayDecimals: number;
}

export const MARKETS = {
  "BTC/USD": {
    id: marketId("BTC/USD"),
    label: "BTC/USD",
    base: "BTC",
    aproFeed: EXTERNAL.aproBtcUsd,
    supraPairId: 0,
    cex: { venue: "binance", symbol: "BTCUSDT", ws: "btcusdt" },
    displayDecimals: 2,
  },
  "HSK/USD": {
    id: marketId("HSK/USD"),
    label: "HSK/USD",
    base: "HSK",
    aproFeed: EXTERNAL.aproHskUsd,
    supraPairId: null, // TODO(confirm): Supra pair index for HSK/USD
    cex: { venue: "gate", symbol: "HSK_USDT", ws: "HSK_USDT" }, // not listed on Binance
    displayDecimals: 4,
  },
} as const satisfies Record<string, MarketInfo>;

export type MarketLabel = keyof typeof MARKETS;

export function marketById(id: string): MarketInfo | undefined {
  return Object.values(MARKETS).find((m) => m.id.toLowerCase() === id.toLowerCase());
}

export const MIN_VALIDITY_SECONDS = 15 * 60;
export const MAX_VALIDITY_SECONDS = 7 * 24 * 60 * 60;
export const MAX_UPSTREAM = 5;

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "expected bytes32").transform((v) => v as Hex);
const address = z
  .string()
  .refine((v) => isAddress(v), "invalid address")
  .transform((v) => v as Address);
const big = z
  .union([z.bigint(), z.string().regex(/^\d+$/), z.number().int().nonnegative()])
  .transform((v) => BigInt(v));

/** Builds the Signal schema. `now` (unix seconds) is injectable for tests. */
export function makeSignalSchema(now: () => number = () => Math.floor(Date.now() / 1000)) {
  return z
    .object({
      provider: address,
      market: hex32,
      side: z.enum(Side),
      entry: big,
      takeProfit: big,
      stopLoss: big,
      validUntil: big,
      pricePerSub: big,
      upstream: z.array(big).max(MAX_UPSTREAM),
      upstreamBps: z.array(z.number().int().min(0).max(10_000)).max(MAX_UPSTREAM),
      salt: hex32,
    })
    .superRefine((s, ctx) => {
      const issue = (message: string, path: string) => ctx.addIssue({ code: "custom", message, path: [path] });
      if (s.side === Side.LONG && !(s.stopLoss < s.entry && s.entry < s.takeProfit))
        issue("LONG requires stopLoss < entry < takeProfit", "entry");
      if (s.side === Side.SHORT && !(s.takeProfit < s.entry && s.entry < s.stopLoss))
        issue("SHORT requires takeProfit < entry < stopLoss", "entry");
      const reward = s.takeProfit > s.entry ? s.takeProfit - s.entry : s.entry - s.takeProfit;
      const risk = s.entry > s.stopLoss ? s.entry - s.stopLoss : s.stopLoss - s.entry;
      if (reward < risk) issue("Reward:risk must be at least 1:1", "takeProfit");
      const t = BigInt(now());
      if (s.validUntil < t + BigInt(MIN_VALIDITY_SECONDS) || s.validUntil > t + BigInt(MAX_VALIDITY_SECONDS))
        issue("validUntil must be between 15 minutes and 7 days ahead", "validUntil");
      if (s.upstream.length !== s.upstreamBps.length) issue("upstream and upstreamBps length mismatch", "upstreamBps");
      if (s.upstreamBps.reduce((a, b) => a + b, 0) > 10_000) issue("upstreamBps sum exceeds 10000", "upstreamBps");
    });
}

export const SignalSchema = makeSignalSchema();

/** EIP-712 digest; equals Solidity `_hashTypedDataV4(structHash)`. This is the commitHash. */
export function hashSignal(s: Signal, chainId: number, signalBook: Address): Hex {
  return hashTypedData({
    domain: nundinaDomain(chainId, signalBook),
    types: SIGNAL_TYPES,
    primaryType: "Signal",
    message: { ...s, side: s.side as number },
  });
}

export function hashCommitAuthorization(a: CommitAuthorization, chainId: number, signalBook: Address): Hex {
  return hashTypedData({
    domain: nundinaDomain(chainId, signalBook),
    types: COMMIT_AUTH_TYPES,
    primaryType: "CommitAuthorization",
    message: a,
  });
}

/** R multiple of a move to `exit`, as a float. */
export function rMultiple(s: Pick<Signal, "side" | "entry" | "stopLoss">, exit: bigint): number {
  const risk = Number(s.side === Side.LONG ? s.entry - s.stopLoss : s.stopLoss - s.entry);
  const move = Number(s.side === Side.LONG ? exit - s.entry : s.entry - exit);
  return risk === 0 ? 0 : move / risk;
}

/** JSON-safe serialization (bigint → string). */
export function serializeSignal(s: Signal) {
  return {
    ...s,
    entry: s.entry.toString(),
    takeProfit: s.takeProfit.toString(),
    stopLoss: s.stopLoss.toString(),
    validUntil: s.validUntil.toString(),
    pricePerSub: s.pricePerSub.toString(),
    upstream: s.upstream.map(String),
  };
}
export type SerializedSignal = ReturnType<typeof serializeSignal>;

export function deserializeSignal(s: SerializedSignal): Signal {
  return {
    ...s,
    entry: BigInt(s.entry),
    takeProfit: BigInt(s.takeProfit),
    stopLoss: BigInt(s.stopLoss),
    validUntil: BigInt(s.validUntil),
    pricePerSub: BigInt(s.pricePerSub),
    upstream: s.upstream.map(BigInt),
  };
}
