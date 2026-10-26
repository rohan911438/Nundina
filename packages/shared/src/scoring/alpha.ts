import type { ScoringSignal } from "./types.js";

/** Signal return in its own direction, in %. */
export function signalReturnPct(s: Pick<ScoringSignal, "side" | "entry" | "exitPrice">): number | null {
  if (!s.side || !s.entry || s.exitPrice == null) return null;
  const move = (s.exitPrice - s.entry) / s.entry;
  return (s.side === "LONG" ? move : -move) * 100;
}

/** BTC buy-and-hold return over the signal's window, in %. */
export function btcReturnPct(s: Pick<ScoringSignal, "btcAtCommit" | "btcAtExit">): number | null {
  if (!s.btcAtCommit || s.btcAtExit == null) return null;
  return ((s.btcAtExit - s.btcAtCommit) / s.btcAtCommit) * 100;
}

/**
 * Market-relative alpha: mean of (signal return − BTC buy-and-hold return) in %.
 * A LONG on BTC that simply rode the market scores ~0. VOID signals and signals without prices
 * are skipped; returns null if none qualify.
 */
export function alphaVsBtc(signals: ScoringSignal[]): number | null {
  const xs: number[] = [];
  for (const s of signals) {
    if (s.outcome === "VOID") continue;
    const r = signalReturnPct(s);
    const b = btcReturnPct(s);
    if (r === null || b === null) continue;
    xs.push(r - b);
  }
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}
