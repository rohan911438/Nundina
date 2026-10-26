/**
 * Exchange trade streams used only as a trigger (truth is the oracle proof): Binance aggTrade for
 * BTC, Gate spot trades for HSK (not listed on Binance). Both reconnect with backoff, and both can
 * backfill 1-minute candles so touches during a keeper outage are still found.
 */
import { MARKETS, toPrice, type MarketInfo } from "@nundina/shared";

export type OnTrade = (market: string, price8: bigint, tsSec: number) => void;
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

const byVenue = (v: MarketInfo["cex"]["venue"]) => Object.values(MARKETS).filter((m) => m.cex.venue === v) as MarketInfo[];

export function binanceTrades(onTrade: OnTrade, log: Log): Stream {
  const markets = byVenue("binance");
  const bySymbol = new Map(markets.map((m) => [m.cex.symbol, m.label]));
  const url = `wss://stream.binance.com:9443/stream?streams=${markets.map((m) => `${m.cex.ws}@aggTrade`).join("/")}`;
  return reconnecting(
    "binance",
    () => new WebSocket(url),
    () => {},
    (raw) => {
      const msg = JSON.parse(raw) as { data?: { s: string; p: string; T: number } };
      const d = msg.data;
      const label = d && bySymbol.get(d.s);
      if (label) onTrade(label, toPrice(d.p), Math.floor(d.T / 1000));
    },
    log,
  );
}

export function gateTrades(onTrade: OnTrade, log: Log): Stream {
  const markets = byVenue("gate");
  const bySymbol = new Map(markets.map((m) => [m.cex.symbol, m.label]));
  return reconnecting(
    "gate",
    () => new WebSocket("wss://api.gateio.ws/ws/v4/"),
    (ws) => ws.send(JSON.stringify({ time: Math.floor(Date.now() / 1000), channel: "spot.trades", event: "subscribe", payload: markets.map((m) => m.cex.symbol) })),
    (raw) => {
      const msg = JSON.parse(raw) as { channel?: string; event?: string; result?: { currency_pair: string; price: string; create_time_ms: string } };
      if (msg.channel !== "spot.trades" || msg.event !== "update" || !msg.result) return;
      const label = bySymbol.get(msg.result.currency_pair);
      if (label) onTrade(label, toPrice(msg.result.price), Math.floor(Number(msg.result.create_time_ms) / 1000));
    },
    log,
  );
}

export type OnCandle = (market: string, low8: bigint, high8: bigint, tsSec: number) => void;

/** 1-minute candles since `fromSec`, for catching up after downtime. */
export async function backfill(fromSec: number, onCandle: OnCandle, fetchImpl: typeof fetch = fetch) {
  for (const m of Object.values(MARKETS) as MarketInfo[]) {
    if (m.cex.venue === "binance") {
      const res = await fetchImpl(`https://api.binance.com/api/v3/klines?symbol=${m.cex.symbol}&interval=1m&startTime=${fromSec * 1000}&limit=1000`);
      if (!res.ok) continue;
      for (const k of (await res.json()) as [number, string, string, string][]) onCandle(m.label, toPrice(k[3]), toPrice(k[2]), Math.floor(k[0] / 1000));
    } else {
      const res = await fetchImpl(`https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${m.cex.symbol}&interval=1m&from=${fromSec}&to=${Math.floor(Date.now() / 1000)}`);
      if (!res.ok) continue;
      // [t, quote volume, close, high, low, open, base volume, closed]
      for (const k of (await res.json()) as string[][]) onCandle(m.label, toPrice(k[4]!), toPrice(k[3]!), Number(k[0]));
    }
  }
}
