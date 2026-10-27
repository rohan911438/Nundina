import { atr, type Candle } from "../indicators.js";
import { fromAtr, validGeometry, type Proposal } from "../geometry.js";

/** |funding| per 8h above which we fade the crowd (0.05% = ~5x the neutral 0.01%). */
export const FUNDING = { threshold: 0.0005, slAtr: 1.5, tpAtr: 2.5, validHours: 8 };

/**
 * Funding-rate mean reversion: extreme positive funding (longs crowded) → SHORT; extreme negative →
 * LONG. Skips when |funding| is below the threshold. ATR from 1h candles.
 */
export function funding(rate: number, h1: Candle[], cfg = FUNDING): Proposal | null {
  if (!Number.isFinite(rate) || Math.abs(rate) < cfg.threshold) return null;
  const a = atr(h1.slice(-50), 14);
  const last = h1.at(-1)?.c;
  if (!a || last == null) return null;
  const side = rate > 0 ? "SHORT" : "LONG";
  const p: Proposal = {
    market: "BTC/USD",
    side,
    ...fromAtr(side, last, a, cfg.slAtr, cfg.tpAtr),
    validHours: cfg.validHours,
    rationale: `perp funding ${(rate * 100).toFixed(3)}% per 8h (threshold ±${(cfg.threshold * 100).toFixed(3)}%): ${side === "SHORT" ? "longs" : "shorts"} crowded, fading`,
  };
  return validGeometry(p, 1.5) ? p : null;
}
