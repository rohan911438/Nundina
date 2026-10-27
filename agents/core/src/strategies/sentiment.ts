import { z } from "zod";
import { atr, type Candle } from "../indicators.js";
import { fromAtr, validGeometry, type Proposal } from "../geometry.js";

export const SENTIMENT = { minAbsScore: 0.6, minSources: 3, maxAgeHours: 6, slAtr: 1.5, tpAtr: 2.5, validHours: 6 };
export const SENTIMENT_MODEL = "claude-haiku-5-5";

export interface Headline {
  title: string;
  source: string;
  publishedAt: number; // ms
}

/** What Claude returns for a batch of headlines. */
export const SentimentRead = z.object({
  score: z.number().describe("-1 (strongly bearish for BTC in the next hours) to 1 (strongly bullish)"),
  confidence: z.number().describe("0-1"),
  reasons: z.array(z.string()).describe("short, one per driver, citing the headline"),
  relevantHeadlines: z.number().int().describe("how many headlines are actually about BTC price drivers"),
});
export type SentimentRead = z.infer<typeof SentimentRead>;

/** Recent headlines only; how many distinct sources they come from. */
export function recent(hs: Headline[], nowMs: number, maxAgeHours = SENTIMENT.maxAgeHours) {
  const fresh = hs.filter((h) => nowMs - h.publishedAt <= maxAgeHours * 3_600_000 && h.publishedAt <= nowMs);
  return { fresh, sources: new Set(fresh.map((h) => h.source)).size };
}

/**
 * Signals only on strong, recent, multi-source sentiment: |score| ≥ 0.6 with confidence ≥ 0.6, at
 * least 3 sources in the last 6 h. The model's reasons go into the rationale (activity log).
 */
export function sentiment(read: SentimentRead | null, sources: number, h1: Candle[], cfg = SENTIMENT): Proposal | null {
  if (!read || sources < cfg.minSources || read.relevantHeadlines < cfg.minSources) return null;
  if (Math.abs(read.score) < cfg.minAbsScore || read.confidence < 0.6) return null;
  const a = atr(h1.slice(-50), 14);
  const last = h1.at(-1)?.c;
  if (!a || last == null) return null;
  const side = read.score > 0 ? "LONG" : "SHORT";
  const p: Proposal = {
    market: "BTC/USD",
    side,
    ...fromAtr(side, last, a, cfg.slAtr, cfg.tpAtr),
    validHours: cfg.validHours,
    rationale: `news sentiment ${read.score.toFixed(2)} (confidence ${read.confidence.toFixed(2)}, ${sources} sources): ${read.reasons.slice(0, 3).join("; ")}`,
  };
  return validGeometry(p, 1.5) ? p : null;
}

export const SENTIMENT_SYSTEM = `You score crypto news headlines for their likely effect on the BTC/USD price over the next few hours.
Be conservative: most headlines are noise; score near 0 unless several independent headlines point the same way.
Never invent headlines; cite the ones you use in reasons.`;
