/**
 * Per-market price history at 1-second resolution (high/low per second), kept for 7 days.
 * Answers "did the other level touch earlier?" for challenges and catches up after downtime.
 */
import { checkBucket, checkBucketLevel, type Level, type WatchedSignal } from "./detectors/touch.js";

export const HISTORY_S = 7 * 24 * 3600;

interface Bucket {
  low: bigint;
  high: bigint;
}

export class PriceHistory {
  private readonly markets = new Map<string, Map<number, Bucket>>();

  /** Records a trade (price with 8 decimals, unix seconds). */
  add(market: string, price: bigint, ts: number) {
    let m = this.markets.get(market);
    if (!m) this.markets.set(market, (m = new Map()));
    const b = m.get(ts);
    if (!b) m.set(ts, { low: price, high: price });
    else {
      if (price < b.low) b.low = price;
      if (price > b.high) b.high = price;
    }
  }

  /** Records a candle as one bucket at its open second (backfill after downtime). */
  addRange(market: string, low: bigint, high: bigint, ts: number) {
    this.add(market, low, ts);
    this.add(market, high, ts);
  }

  latest(market: string): { price: bigint; ts: number } | null {
    const m = this.markets.get(market);
    if (!m?.size) return null;
    let ts = -1;
    for (const k of m.keys()) if (k > ts) ts = k;
    const b = m.get(ts)!;
    return { price: (b.low + b.high) / 2n, ts };
  }

  /** First bucket in [from, to] where `w` touches a level (optionally only `only`). */
  firstTouch(market: string, w: WatchedSignal, from: number, to: number, only?: Level): { level: Level; price: bigint; ts: number } | null {
    const m = this.markets.get(market);
    if (!m) return null;
    const keys = [...m.keys()].filter((k) => k >= from && k <= to).sort((a, b) => a - b);
    for (const ts of keys) {
      const b = m.get(ts)!;
      if (only === undefined) {
        const hit = checkBucket(w, b.low, b.high, ts);
        if (hit) return { ...hit, ts };
      } else {
        const price = checkBucketLevel(w, b.low, b.high, ts, only);
        if (price != null) return { level: only, price, ts };
      }
    }
    return null;
  }

  prune(now: number) {
    for (const m of this.markets.values()) for (const k of m.keys()) if (k < now - HISTORY_S) m.delete(k);
  }
}
