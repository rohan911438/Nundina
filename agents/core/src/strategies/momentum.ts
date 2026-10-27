import { atr, ema, resample, type Candle } from "../indicators.js";
import { fromAtr, validGeometry, type Proposal } from "../geometry.js";

export const MOMENTUM = { fast: 9, slow: 21, slAtr: 1.5, tpAtr: 2.5, validHours: 12 };

/**
 * Momentum: the 1h EMA(9/21) just crossed and the 4h EMA(9/21) agrees. SL 1.5 ATR(1h), TP 2.5 ATR.
 * Needs ≥ 100 one-hour candles (oldest first). Returns null when there is no fresh cross.
 */
export function momentum(h1: Candle[], cfg = MOMENTUM): Proposal | null {
  if (h1.length < 100) return null;
  const close = h1.map((c) => c.c);
  const f = ema(close, cfg.fast);
  const s = ema(close, cfg.slow);
  // align the two series on their last values
  const n = Math.min(f.length, s.length);
  const fa = f.slice(-n);
  const sa = s.slice(-n);
  const now = fa[n - 1]! - sa[n - 1]!;
  const prev = fa[n - 2]! - sa[n - 2]!;
  const crossedUp = prev <= 0 && now > 0;
  const crossedDown = prev >= 0 && now < 0;
  if (!crossedUp && !crossedDown) return null;

  const h4 = resample(h1, 4).map((c) => c.c);
  const f4 = ema(h4, cfg.fast).at(-1);
  const s4 = ema(h4, cfg.slow).at(-1);
  if (f4 == null || s4 == null) return null;
  const side = crossedUp ? "LONG" : "SHORT";
  if ((side === "LONG" && f4 <= s4) || (side === "SHORT" && f4 >= s4)) return null;

  const a = atr(h1.slice(-50), 14);
  if (!a) return null;
  const lv = fromAtr(side, close.at(-1)!, a, cfg.slAtr, cfg.tpAtr);
  const p: Proposal = {
    market: "BTC/USD",
    side,
    ...lv,
    validHours: cfg.validHours,
    rationale: `1h EMA${cfg.fast} crossed ${crossedUp ? "above" : "below"} EMA${cfg.slow}; 4h trend agrees; ATR(14,1h) ${a.toFixed(0)}`,
  };
  return validGeometry(p, 1.5) ? p : null;
}
