import { rOf } from "./expectancy";
import type { ScoringSignal } from "./types";

/** Largest peak-to-trough fall of cumulative R, in R (≥ 0), in decision order. */
export function maxDrawdownR(signals: Pick<ScoringSignal, "outcome" | "rMultiple" | "decidedAt">[]): number {
  const ordered = [...signals].sort((a, b) => a.decidedAt - b.decidedAt);
  let equity = 0;
  let peak = 0;
  let dd = 0;
  for (const s of ordered) {
    const r = rOf(s);
    if (r === null) continue;
    equity += r;
    peak = Math.max(peak, equity);
    dd = Math.max(dd, peak - equity);
  }
  return dd;
}
