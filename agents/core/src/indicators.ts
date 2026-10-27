/** Candle as the strategies use it (numbers in USD). */
export interface Candle {
  t: number; // open time, ms
  o: number;
  h: number;
  l: number;
  c: number;
}

/** Exponential moving average of `values` (seeded with the SMA of the first `period`). */
export function ema(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out = [prev];
  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

/** Wilder's average true range over `period` candles; null when there's not enough data. */
export function atr(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  const tr: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!;
    const p = candles[i - 1]!;
    tr.push(Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c)));
  }
  let a = tr.slice(0, period).reduce((x, y) => x + y, 0) / period;
  for (let i = period; i < tr.length; i++) a = (a * (period - 1) + tr[i]!) / period;
  return a;
}

/** Groups 1h candles into 4h candles aligned to UTC 00/04/08/... */
export function resample(candles: Candle[], hours: number): Candle[] {
  const ms = hours * 3_600_000;
  const out: Candle[] = [];
  for (const c of candles) {
    const t = Math.floor(c.t / ms) * ms;
    const last = out.at(-1);
    if (last && last.t === t) {
      last.h = Math.max(last.h, c.h);
      last.l = Math.min(last.l, c.l);
      last.c = c.c;
    } else out.push({ t, o: c.o, h: c.h, l: c.l, c: c.c });
  }
  return out;
}
