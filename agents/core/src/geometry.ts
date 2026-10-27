/** A signal as strategies produce it, in USD numbers. */
export interface Proposal {
  market: "BTC/USD" | "HSK/USD";
  side: "LONG" | "SHORT";
  entry: number;
  takeProfit: number;
  stopLoss: number;
  validHours: number;
  /** Shown in the activity log and the draft text. */
  rationale: string;
}

export const reward = (p: Pick<Proposal, "entry" | "takeProfit">) => Math.abs(p.takeProfit - p.entry);
export const risk = (p: Pick<Proposal, "entry" | "stopLoss">) => Math.abs(p.entry - p.stopLoss);
export const rr = (p: Pick<Proposal, "entry" | "takeProfit" | "stopLoss">) => reward(p) / risk(p);

/** Same rules as the shared schema and SignalBook: TP and SL on the right sides, R:R ≥ min. */
export function validGeometry(p: Proposal, minRR = 1): boolean {
  const ordered = p.side === "LONG" ? p.stopLoss < p.entry && p.entry < p.takeProfit : p.takeProfit < p.entry && p.entry < p.stopLoss;
  return ordered && rr(p) >= minRR - 1e-9 && p.validHours >= 0.25 && p.validHours <= 168;
}

/** Levels from an ATR band, rounded to the market's tick. */
export function fromAtr(side: Proposal["side"], entry: number, atrValue: number, slAtr: number, tpAtr: number, dp = 2) {
  const f = 10 ** dp;
  const round = (v: number) => Math.round(v * f) / f;
  const dir = side === "LONG" ? 1 : -1;
  return { entry: round(entry), stopLoss: round(entry - dir * slAtr * atrValue), takeProfit: round(entry + dir * tpAtr * atrValue) };
}
