import type { ScoringSignal } from "./types";

/** R result of one signal: wins at their R, losses and unrevealed at −1R, VOID → null (excluded). */
export function rOf(s: Pick<ScoringSignal, "outcome" | "rMultiple">): number | null {
  if (s.outcome === "VOID") return null;
  if (s.outcome === "WIN") return s.rMultiple;
  return -1;
}

/** Mean R per decided signal. */
export function expectancy(signals: Pick<ScoringSignal, "outcome" | "rMultiple">[]): number {
  const rs = signals.map(rOf).filter((r): r is number => r !== null);
  return rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : 0;
}
