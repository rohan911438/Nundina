import { rr, validGeometry, type Proposal } from "./geometry.js";

/** An upstream signal the aggregator bought and decrypted. */
export interface Upstream {
  signalId: string;
  score: number;
  side: "LONG" | "SHORT";
  entry: number;
  takeProfit: number;
  stopLoss: number;
  validUntil: number; // unix s
}

/** Upstream providers share 70% of the aggregator's revenue; the aggregator keeps 30%. */
export const UPSTREAM_TOTAL_BPS = 7000;

export interface Blend {
  proposal: Proposal;
  upstream: string[];
  upstreamBps: number[];
}

/** Score weights (floored at 1 so a zero score still counts a little). */
export function weights(us: Upstream[]): number[] {
  const w = us.map((u) => Math.max(u.score, 1));
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / sum);
}

/** Splits `total` bps by weight; rounding remainder goes to the heaviest so the sum is exact. */
export function splitBps(ws: number[], total = UPSTREAM_TOTAL_BPS): number[] {
  const bps = ws.map((w) => Math.floor(w * total));
  const rest = total - bps.reduce((a, b) => a + b, 0);
  const top = ws.indexOf(Math.max(...ws));
  bps[top]! += rest;
  return bps;
}

/**
 * Score-weighted vote for direction; entry at the current price; TP/SL at the weighted average of
 * upstream distances (only upstreams on the winning side), widened TP if needed to keep R:R ≥ 1.
 * Every bought upstream is credited (it informed the vote), weighted by score.
 */
export function blend(us: Upstream[], price: number, nowS: number, market: Proposal["market"] = "BTC/USD"): Blend | null {
  if (!us.length) return null;
  const ws = weights(us);
  const vote = us.reduce((a, u, i) => a + (u.side === "LONG" ? ws[i]! : -ws[i]!), 0);
  if (Math.abs(vote) < 1e-9) return null; // split decision: no meta-signal
  const side = vote > 0 ? "LONG" : "SHORT";
  const same = us.map((u, i) => ({ u, w: ws[i]! })).filter((x) => x.u.side === side);
  const wsum = same.reduce((a, x) => a + x.w, 0);
  const tpDist = same.reduce((a, x) => a + x.w * (Math.abs(x.u.takeProfit - x.u.entry) / x.u.entry), 0) / wsum;
  const slDist = same.reduce((a, x) => a + x.w * (Math.abs(x.u.entry - x.u.stopLoss) / x.u.entry), 0) / wsum;
  const dir = side === "LONG" ? 1 : -1;
  const round = (v: number) => Math.round(v * 100) / 100;
  const tp = Math.max(tpDist, slDist); // keep R:R ≥ 1
  const validUntil = Math.min(...us.map((u) => u.validUntil));
  const validHours = Math.max(0.25, Math.min(24, (validUntil - nowS) / 3600));
  const proposal: Proposal = {
    market,
    side,
    entry: round(price),
    takeProfit: round(price * (1 + dir * tp)),
    stopLoss: round(price * (1 - dir * slDist)),
    validHours: Math.round(validHours * 100) / 100,
    rationale: `blend of ${us.map((u) => `#${u.signalId} ${u.side} (score ${u.score})`).join(", ")}: vote ${vote > 0 ? "+" : ""}${vote.toFixed(2)}`,
  };
  if (!validGeometry(proposal, 1)) return null;
  return { proposal, upstream: us.map((u) => u.signalId), upstreamBps: splitBps(ws) };
}

export { rr };
