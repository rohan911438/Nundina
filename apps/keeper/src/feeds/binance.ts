/**
 * Exchange trade streams used only as a trigger (truth is the oracle proof): Binance aggTrade for
 * BTC, Gate spot trades for HSK (not listed on Binance). Gate also carries BTC as a backup for
 * regions where Binance is blocked. Both reconnect with backoff, and both can backfill 1-minute
 * candles so touches during a keeper outage are still found.
 */
import { MARKETS, toPrice, type CexListing, type MarketInfo } from "@nundina/shared";

/** `primary` is false for a backup venue's trade: the caller only uses those while the primary is silent. */
export type OnTrade = (market: string, price8: bigint, tsSec: number, primary: boolean) => void;
type Log = (level: "info" | "warn" | "error", msg: string, extra?: object) => void;

interface Stream {
  close(): void;
}

function reconnecting(name: string, open: () => WebSocket, onOpen: (ws: WebSocket) => void, onMessage: (data: string) => void, log: Log): Stream {
  let ws: WebSocket | null = null;
  let closed = false;
  let delay = 1000;
  let ping: ReturnType<typeof setInterval> | undefined;
  const connect = () => {
    ws = open();
    ws.onopen = () => {
      delay = 1000;
      log("info", `${name} connected`);
      onOpen(ws!);
    };
    ws.onmessage = (ev) => onMessage(String(ev.data));
    ws.onclose = () => {
      clearInterval(ping);
      if (closed) return;
      log("warn", `${name} disconnected; retrying`, { inMs: delay });
      setTimeout(connect, delay);
      delay = Math.min(delay * 2, 60_000);
    };
    ws.onerror = () => ws?.close();
    if (name === "gate") ping = setInterval(() => ws?.readyState === 1 && ws.send(JSON.stringify({ time: Math.floor(Date.now() / 1000), channel: "spot.ping" })), 20_000);
  };
  connect();
  return {
    close() {
      closed = true;
      clearInterval(ping);
      ws?.close();
    },
  };
}

type Listing = CexListing & { label: string; primary: boolean };

/** Every pair a venue carries for us, as primary or backup listing. */
const byVenue = (v: CexListing["venue"]): Listing[] =>
  (Object.values(MARKETS) as MarketInfo[]).flatMap((m) => [
    ...(m.cex.venue === v ? [{ ...m.cex, label: m.label, primary: true }] : []),
    ...(m.backupCex?.venue === v ? [{ ...m.backupCex, label: m.label, primary: false }] : []),
  ]);

export function binanceTrades(onTrade: OnTrade, log: Log): Stream {
  const markets = byVenue("binance");
  const bySymbol = new Map(markets.map((m) => [m.symbol, m]));
  const url = `wss://stream.binance.com:9443/stream?streams=${markets.map((m) => `${m.ws}@aggTrade`).join("/")}`;
  return reconnecting(
    "binance",
    () => new WebSocket(url),
    () => {},
    (raw) => {
      const msg = JSON.parse(raw) as { data?: { s: string; p: string; T: number } };
      const d = msg.data;
      const m = d && bySymbol.get(d.s);
      if (m) onTrade(m.label, toPrice(d.p), Math.floor(d.T / 1000), m.primary);
    },
    log,
  );
}

export function gateTrades(onTrade: OnTrade, log: Log): Stream {
  const markets = byVenue("gate");
  const bySymbol = new Map(markets.map((m) => [m.symbol, m]));
  return reconnecting(
    "gate",
    () => new WebSocket("wss://api.gateio.ws/ws/v4/"),
    (ws) => ws.send(JSON.stringify({ time: Math.floor(Date.now() / 1000), channel: "spot.trades", event: "subscribe", payload: markets.map((m) => m.symbol) })),
    (raw) => {
      const msg = JSON.parse(raw) as { channel?: string; event?: string; result?: { currency_pair: string; price: string; create_time_ms: string } };
      if (msg.channel !== "spot.trades" || msg.event !== "update" || !msg.result) return;
      const m = bySymbol.get(msg.result.currency_pair);
      if (m) onTrade(m.label, toPrice(msg.result.price), Math.floor(Number(msg.result.create_time_ms) / 1000), m.primary);
    },
    log,
  );
}

export type OnCandle = (market: string, low8: bigint, high8: bigint, tsSec: number) => void;

/** 1-minute candles of one listing since `fromSec`, as [ts, low, high]; throws if the venue is unreachable. */
async function candles(c: CexListing, fromSec: number, fetchImpl: typeof fetch): Promise<[number, bigint, bigint][]> {
  if (c.venue === "binance") {
    const res = await fetchImpl(`https://api.binance.com/api/v3/klines?symbol=${c.symbol}&interval=1m&startTime=${fromSec * 1000}&limit=1000`);
    if (!res.ok) throw new Error(`binance ${res.status}`);
    return ((await res.json()) as [number, string, string, string][]).map((k) => [Math.floor(k[0] / 1000), toPrice(k[3]), toPrice(k[2])]);
  }
  const res = await fetchImpl(`https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${c.symbol}&interval=1m&from=${fromSec}&to=${Math.floor(Date.now() / 1000)}`);
  if (!res.ok) throw new Error(`gate ${res.status}`);
  // [t, quote volume, close, high, low, open, base volume, closed]
  return ((await res.json()) as string[][]).map((k) => [Number(k[0]), toPrice(k[4]!), toPrice(k[3]!)]);
}

/**
 * 1-minute candles since `fromSec`, for catching up after downtime. Per market the backup venue is
 * tried when the primary fails, and one unreachable venue never stops the other markets.
 * Returns the markets that could not be backfilled.
 */
export async function backfill(fromSec: number, onCandle: OnCandle, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const failed: string[] = [];
  for (const m of Object.values(MARKETS) as MarketInfo[]) {
    let rows: [number, bigint, bigint][] | null = null;
    for (const c of [m.cex, m.backupCex]) {
      if (c && !rows) rows = await candles(c, fromSec, fetchImpl).catch(() => null);
    }
    if (!rows) failed.push(m.label);
    for (const [ts, lo, hi] of rows ?? []) onCandle(m.label, lo, hi, ts);
  }
  return failed;
}
