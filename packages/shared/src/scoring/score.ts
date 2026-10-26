import { alphaVsBtc } from "./alpha";
import { maxDrawdownR } from "./drawdown";
import { expectancy } from "./expectancy";
import { MIN_RANKED, type ScoreBreakdown, type ScoringSignal } from "./types";
import { wilsonLowerBound } from "./wilson";

export const WEIGHTS = { wilson: 0.4, expectancy: 0.3, alpha: 0.2, drawdown: 0.1 } as const;
export const EXPECTANCY_RANGE = [-1, 2] as const; // R
export const ALPHA_RANGE = [-5, 5] as const; // %
/** A drawdown this deep (in R) takes the full drawdown penalty. */
export const DRAWDOWN_FULL_PENALTY_R = 10;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const scale = (x: number, [lo, hi]: readonly [number, number]) => (clamp(x, lo, hi) - lo) / (hi - lo);

/** Components scaled to 0..1, each non-decreasing in "better". */
export function components(b: Pick<ScoreBreakdown, "wilsonLb" | "expectancyR" | "alphaPct" | "maxDrawdownR">) {
  return {
    wilson: clamp(b.wilsonLb, 0, 1),
    expectancy: scale(b.expectancyR, EXPECTANCY_RANGE),
    // no price data → neutral alpha (0%)
    alpha: scale(b.alphaPct ?? 0, ALPHA_RANGE),
    drawdown: 1 - clamp(b.maxDrawdownR / DRAWDOWN_FULL_PENALTY_R, 0, 1),
  };
}

/** 0–100 composite from already computed metrics (see README.md). */
export function compositeScore(b: Pick<ScoreBreakdown, "wilsonLb" | "expectancyR" | "alphaPct" | "maxDrawdownR">): number {
  const c = components(b);
  const s =
    WEIGHTS.wilson * c.wilson + WEIGHTS.expectancy * c.expectancy + WEIGHTS.alpha * c.alpha + WEIGHTS.drawdown * c.drawdown;
  return Math.round(s * 10_000) / 100;
}

/** Full breakdown for one provider (one period/market slice). */
export function scoreProvider(signals: ScoringSignal[], minRanked = MIN_RANKED): ScoreBreakdown {
  const voids = signals.filter((s) => s.outcome === "VOID").length;
  const decided = signals.filter((s) => s.outcome !== "VOID");
  const wins = decided.filter((s) => s.outcome === "WIN").length;
  const n = decided.length;
  const follower = signals.map((s) => s.followerPnlPct).filter((x): x is number => typeof x === "number");
  const metrics = {
    wilsonLb: wilsonLowerBound(wins, n),
    expectancyR: expectancy(decided),
    alphaPct: alphaVsBtc(decided),
    maxDrawdownR: maxDrawdownR(decided),
  };
  const probation = n < minRanked;
  return {
    n,
    wins,
    losses: n - wins,
    voids,
    winRate: n ? wins / n : 0,
    ...metrics,
    followerPnlPct: follower.length ? follower.reduce((a, b) => a + b, 0) / follower.length : null,
    probation,
    score: probation ? null : compositeScore(metrics),
  };
}
