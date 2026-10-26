import type { Outcome, Side } from "./enums.js";

/** One settled signal as input to scoring (prompt 08 implements the math). */
export interface ScoredSignal {
  signalId: string;
  provider: string;
  market: string;
  side: Side;
  outcome: Outcome;
  /** R multiple × 100 as reported by OutcomeResolver. */
  rX100: number;
  committedAt: number;
  resolvedAt: number;
  /** BTC buy-and-hold return over the same window, as a fraction. */
  benchmarkReturn?: number;
  /** Signal return as a fraction of entry. */
  signalReturn?: number;
  unrevealed?: boolean;
}

export interface ProviderScore {
  provider: string;
  sampleSize: number;
  wins: number;
  losses: number;
  winRate: number;
  wilsonLower: number;
  expectancyR: number;
  alphaVsBtc: number;
  maxDrawdownR: number;
  followerPnlUsd: number;
  ranked: boolean;
  compositeScore: number;
  updatedAt: number;
}

export const MIN_RANKED_SIGNALS = 30;
