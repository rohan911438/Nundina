import type { ApiSignal } from "@nundina/shared";

/**
 * Cumulative R by decision time from a provider's settled signals. Unrevealed signals count as
 * −1R, voids as 0. Times are unix seconds, strictly increasing (lightweight-charts requires it).
 */
export function equityPoints(signals: Pick<ApiSignal, "decidedAt" | "rMultiple" | "outcome" | "status">[]) {
  const decided = signals
    .filter((s) => s.decidedAt && s.outcome)
    .map((s) => ({ t: Math.floor(Date.parse(s.decidedAt!) / 1000), r: s.status === "UNREVEALED_LOSS" ? -1 : (s.rMultiple ?? 0) }))
    .sort((a, b) => a.t - b.t);
  const out: { time: number; value: number }[] = [];
  let sum = 0;
  let last = -Infinity;
  for (const d of decided) {
    sum += d.r;
    const time = d.t <= last ? last + 1 : d.t;
    last = time;
    out.push({ time, value: Math.round(sum * 100) / 100 });
  }
  return out;
}
