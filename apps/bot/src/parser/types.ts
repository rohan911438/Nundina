import { MARKETS, Side, makeSignalSchema, toPrice } from "@nundina/shared";

export type SupportedMarket = keyof typeof MARKETS;

/** A signal as read from a channel post. Prices are decimal strings in quote currency. */
export interface ParsedSignal {
  market: SupportedMarket;
  side: "LONG" | "SHORT";
  entry: string;
  takeProfit: string;
  stopLoss: string;
  validHours: number;
  /** Notes shown in the provider's confirm DM (e.g. "first of 3 targets used as TP"). */
  notes: string[];
}

export type ParseResult =
  | { ok: true; signal: ParsedSignal; parser: "rules" | "llm" }
  /** not_signal: ignore silently. Others: DM the provider why. */
  | { ok: false; reason: "not_signal" | "unsupported_market" | "incomplete" | "invalid"; detail: string };

export const DEFAULT_VALID_HOURS = 24;

const DUMMY_ADDR = "0x0000000000000000000000000000000000000001";
const DUMMY_SALT = `0x${"00".repeat(32)}`;

/**
 * Runs the same zod validation the API applies at commit (geometry, R:R ≥ 1, validity window).
 * Returns the problems in plain words, or [] when the signal is committable.
 */
export function validate(s: ParsedSignal, now = Math.floor(Date.now() / 1000)): string[] {
  let prices: { entry: bigint; takeProfit: bigint; stopLoss: bigint };
  try {
    prices = { entry: toPrice(s.entry), takeProfit: toPrice(s.takeProfit), stopLoss: toPrice(s.stopLoss) };
  } catch {
    return ["prices are not numbers"];
  }
  const r = makeSignalSchema(() => now).safeParse({
    provider: DUMMY_ADDR,
    market: MARKETS[s.market].id,
    side: s.side === "LONG" ? Side.LONG : Side.SHORT,
    ...prices,
    validUntil: now + Math.round(s.validHours * 3600),
    pricePerSub: 0,
    upstream: [],
    upstreamBps: [],
    salt: DUMMY_SALT,
  });
  return r.success ? [] : r.error.issues.map((i) => i.message);
}
