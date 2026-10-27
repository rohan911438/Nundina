import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { env } from "./env.js";
import type { Candle } from "./indicators.js";
import { SENTIMENT_MODEL, SENTIMENT_SYSTEM, SentimentRead, type Headline } from "./strategies/sentiment.js";

const TIMEOUT = 10_000;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT), headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Binance spot klines, oldest first. */
export async function klines(symbol = "BTCUSDT", interval = "1h", limit = 300): Promise<Candle[]> {
  const rows = await getJson<[number, string, string, string, string][]>(`${env().BINANCE_URL}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  return rows.map((r) => ({ t: r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4] }));
}

/** Last perpetual funding rate (per 8h, e.g. 0.0001 = 0.01%). */
export async function fundingRate(symbol = "BTCUSDT"): Promise<number> {
  const r = await getJson<{ lastFundingRate: string }>(`${env().BINANCE_FUTURES_URL}/fapi/v1/premiumIndex?symbol=${symbol}`);
  return Number(r.lastFundingRate);
}

export async function lastPrice(symbol = "BTCUSDT"): Promise<number> {
  const r = await getJson<{ price: string }>(`${env().BINANCE_URL}/api/v3/ticker/price?symbol=${symbol}`);
  return Number(r.price);
}

/** Minimal RSS/Atom reader: title + pubDate per item. */
export function parseFeed(xml: string, source: string): Headline[] {
  const items = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/g) ?? [];
  const pick = (s: string, tag: string) =>
    s
      .match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))?.[1]
      ?.replace(/<!\[CDATA\[|\]\]>/g, "")
      .trim();
  return items
    .map((it) => {
      const title = pick(it, "title");
      const date = pick(it, "pubDate") ?? pick(it, "published") ?? pick(it, "updated");
      return title && date ? { title: decode(title), source, publishedAt: Date.parse(date) } : null;
    })
    .filter((h): h is Headline => h != null && Number.isFinite(h.publishedAt));
}

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

export async function headlines(feeds = env().NEWS_FEEDS.split(",")): Promise<Headline[]> {
  const out = await Promise.allSettled(
    feeds.map(async (u) => {
      const res = await fetch(u.trim(), { signal: AbortSignal.timeout(TIMEOUT) });
      if (!res.ok) throw new Error(`${u}: HTTP ${res.status}`);
      return parseFeed(await res.text(), new URL(u).hostname.replace(/^www\./, ""));
    }),
  );
  return out.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}

/** Claude reads the headlines; null without an API key (the agent then never signals). */
export async function readSentiment(hs: Headline[]): Promise<SentimentRead | null> {
  const key = env().ANTHROPIC_API_KEY;
  if (!key || !hs.length) return null;
  const client = new Anthropic({ apiKey: key, timeout: 20_000, maxRetries: 1 });
  const list = hs
    .slice(0, 60)
    .map((h) => `- [${h.source}, ${new Date(h.publishedAt).toISOString()}] ${h.title}`)
    .join("\n");
  const res = await client.messages.parse({
    model: SENTIMENT_MODEL,
    max_tokens: 1024,
    output_config: { effort: "low", format: zodOutputFormat(SentimentRead) },
    system: SENTIMENT_SYSTEM,
    messages: [{ role: "user", content: `Headlines from the last hours:\n${list}` }],
  });
  if (res.stop_reason === "refusal") return null;
  return res.parsed_output ?? null;
}
