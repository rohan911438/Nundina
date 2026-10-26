/** One decided signal as input to scoring. Prices are plain numbers (display units). */
export interface ScoringSignal {
  /** WIN | LOSS | VOID | UNREVEALED (an unrevealed signal is a loss). */
  outcome: "WIN" | "LOSS" | "VOID" | "UNREVEALED";
  /** R multiple reported on-chain (rX100 / 100). Losses count as −1R regardless. */
  rMultiple: number;
  /** Unix seconds. */
  committedAt: number;
  /** When the outcome was decided (touch or expiry), unix seconds. */
  decidedAt: number;
  market: string;
  side?: "LONG" | "SHORT";
  entry?: number;
  exitPrice?: number;
  /** BTC price at commit and at decision, for the market-relative alpha. */
  btcAtCommit?: number;
  btcAtExit?: number;
  /** Realised follower result for this signal in %, after fees (from execution agents). */
  followerPnlPct?: number;
}

export interface ScoreBreakdown {
  /** Decided signals (VOID excluded). */
  n: number;
  wins: number;
  losses: number;
  voids: number;
  winRate: number;
  wilsonLb: number;
  expectancyR: number;
  /** Mean % edge over BTC buy-and-hold, null when no signal had prices. */
  alphaPct: number | null;
  maxDrawdownR: number;
  followerPnlPct: number | null;
  probation: boolean;
  /** 0–100; null while on probation. */
  score: number | null;
}

/** No ranking below this many decided signals. */
export const MIN_RANKED = 30;
