/**
 * Crossing detection. Pure functions over a signal and prices; the chain decides the truth.
 *
 * Rules (mirroring OutcomeResolver):
 * - A limit signal must first touch its ENTRY (from the side of the oracle price at commit);
 *   TP/SL only count after that.
 * - LONG: TP when price >= TP, SL when price <= SL. SHORT: the reverse.
 * - When one price bucket spans both levels (a gap or a wide 1-second candle) we can't tell
 *   which came first, so SL wins. The on-chain rule is "first proof-backed crossing"; picking SL
 *   here only decides which proof we try first and never claims a WIN we can't order.
 */
import { Side, type Signal } from "@nundina/shared";

export const TP = 0;
export const SL = 1;
export const ENTRY = 2;
export type Level = typeof TP | typeof SL | typeof ENTRY;

export interface WatchedSignal {
  id: bigint;
  s: Signal;
  isLimit: boolean;
  oraclePriceAtCommit: bigint;
  committedAt: number;
  validUntil: number;
  /** Oracle timestamp of the proven entry touch (0 = not yet). */
  entryTouchedAt: number;
}

export function entryCrossed(w: WatchedSignal, price: bigint) {
  return w.s.entry < w.oraclePriceAtCommit ? price <= w.s.entry : price >= w.s.entry;
}

export function levelCrossed(s: Signal, level: typeof TP | typeof SL, price: bigint) {
  const long = s.side === Side.LONG;
  if (level === TP) return long ? price >= s.takeProfit : price <= s.takeProfit;
  return long ? price <= s.stopLoss : price >= s.stopLoss;
}

/** The level a single trade at `price` (time `ts`) touches, if any. */
export function checkTick(w: WatchedSignal, price: bigint, ts: number): Level | null {
  if (ts < w.committedAt || ts > w.validUntil) return null;
  if (w.isLimit && !w.entryTouchedAt) return entryCrossed(w, price) ? ENTRY : null;
  if (w.isLimit && ts <= w.entryTouchedAt) return null;
  if (levelCrossed(w.s, SL, price)) return SL;
  if (levelCrossed(w.s, TP, price)) return TP;
  return null;
}

/** The level a [low, high] bucket touches; SL first when both are inside it. */
export function checkBucket(w: WatchedSignal, low: bigint, high: bigint, ts: number): { level: Level; price: bigint } | null {
  if (ts < w.committedAt || ts > w.validUntil) return null;
  const long = w.s.side === Side.LONG;
  if (w.isLimit && !w.entryTouchedAt) {
    const p = w.s.entry < w.oraclePriceAtCommit ? low : high;
    return entryCrossed(w, p) ? { level: ENTRY, price: p } : null;
  }
  if (w.isLimit && ts <= w.entryTouchedAt) return null;
  const slPrice = long ? low : high;
  if (levelCrossed(w.s, SL, slPrice)) return { level: SL, price: slPrice };
  const tpPrice = long ? high : low;
  if (levelCrossed(w.s, TP, tpPrice)) return { level: TP, price: tpPrice };
  return null;
}

/** Whether a [low, high] bucket touches one specific level. */
export function checkBucketLevel(w: WatchedSignal, low: bigint, high: bigint, ts: number, level: Level): bigint | null {
  if (ts < w.committedAt || ts > w.validUntil) return null;
  const long = w.s.side === Side.LONG;
  if (level === ENTRY) {
    if (!w.isLimit) return null;
    const p = w.s.entry < w.oraclePriceAtCommit ? low : high;
    return entryCrossed(w, p) ? p : null;
  }
  if (w.isLimit && (!w.entryTouchedAt || ts <= w.entryTouchedAt)) return null;
  const p = level === SL ? (long ? low : high) : long ? high : low;
  return levelCrossed(w.s, level, p) ? p : null;
}
