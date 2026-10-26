import { and, asc, eq, gte, lte } from "drizzle-orm";
import { MARKETS, type MarketLabel } from "@nundina/shared";
import { db } from "../db/client.js";
import { priceCandles } from "../db/schema.js";
import { badRequest } from "../lib/errors.js";
import { log } from "../lib/log.js";

export const INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
export type Interval = (typeof INTERVALS)[number];
const INTERVAL_MS: Record<Interval, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};
const MAX_CANDLES = 1000;

export interface Candle {
  t: number; // open time, ms
  o: string;
  h: string;
  l: string;
  c: string;
  v: string;
}

type FetchFn = typeof fetch;
let fetcher: FetchFn = (...a) => fetch(...a);
/** Test hook. */
export function setPriceFetcher(f: FetchFn) {
  fetcher = f;
}

/** Raw klines from the market's CEX (Binance for BTC, Gate for HSK). */
async function fetchKlines(market: MarketLabel, interval: Interval, from: number, to: number): Promise<Candle[]> {
  const m = MARKETS[market];
  if (m.cex.venue === "binance") {
    const url = `https://api.binance.com/api/v3/klines?symbol=${m.cex.symbol}&interval=${interval}&startTime=${from}&endTime=${to}&limit=${MAX_CANDLES}`;
    const res = await fetcher(url);
    if (!res.ok) throw new Error(`binance ${res.status}`);
    const rows = (await res.json()) as [number, string, string, string, string, string][];
    return rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }));
  }
  // Gate.io: seconds; row = [t, quoteVol, close, high, low, open, baseVol, closed]
  const url = `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${m.cex.symbol}&interval=${interval}&from=${Math.floor(from / 1000)}&to=${Math.floor(to / 1000)}`;
  const res = await fetcher(url);
  if (!res.ok) throw new Error(`gate ${res.status}`);
  const rows = (await res.json()) as string[][];
  return rows.map((r) => ({ t: Number(r[0]) * 1000, o: r[5]!, h: r[3]!, l: r[4]!, c: r[2]!, v: r[6] ?? "0" }));
}

/**
 * OHLC for charts. Serves from the Postgres cache; fetches and stores missing closed candles.
 * Falls back to whatever is cached if the exchange is unreachable.
 */
export async function getCandles(market: string, interval: Interval, from: number, to: number): Promise<Candle[]> {
  if (!(market in MARKETS)) throw badRequest("bad_market", `Unknown market ${market}`);
  const step = INTERVAL_MS[interval];
  if (to <= from) throw badRequest("bad_range", "to must be after from");
  if ((to - from) / step > MAX_CANDLES) throw badRequest("bad_range", `At most ${MAX_CANDLES} candles per request`);

  const cached = await readCache(market, interval, from, to);
  const expected = Math.floor((Math.min(to, Date.now()) - from) / step);
  if (cached.length >= expected) return cached;

  try {
    const fresh = await fetchKlines(market as MarketLabel, interval, from, to);
    const closed = fresh.filter((k) => k.t + step <= Date.now());
    if (closed.length) {
      await db()
        .insert(priceCandles)
        .values(
          closed.map((k) => ({
            market,
            interval,
            openTime: new Date(k.t),
            open: k.o,
            high: k.h,
            low: k.l,
            close: k.c,
            volume: k.v,
          })),
        )
        .onConflictDoNothing();
    }
    return fresh;
  } catch (err) {
    log.warn({ err, market, interval }, "price fetch failed, serving cache");
    return cached;
  }
}

async function readCache(market: string, interval: Interval, from: number, to: number): Promise<Candle[]> {
  const rows = await db()
    .select()
    .from(priceCandles)
    .where(
      and(
        eq(priceCandles.market, market),
        eq(priceCandles.interval, interval),
        gte(priceCandles.openTime, new Date(from)),
        lte(priceCandles.openTime, new Date(to)),
      ),
    )
    .orderBy(asc(priceCandles.openTime));
  return rows.map((r) => ({ t: r.openTime.getTime(), o: r.open, h: r.high, l: r.low, c: r.close, v: r.volume }));
}
