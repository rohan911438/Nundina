/**
 * Rule-based parser for the signal formats channels actually use: Cornix blocks
 * (`#BTC/USDT LONG / Entry: a - b / Targets: x - y / Stop: z`) and one-liners
 * (`BTC LONG 81.5k TP 84k SL 80.2k 24h`). Anything it cannot read fully goes to the LLM fallback.
 */
import { DEFAULT_VALID_HOURS, type ParseResult, type ParsedSignal, type SupportedMarket } from "./types.js";

const SUPPORTED: { market: SupportedMarket; re: RegExp }[] = [
  { market: "BTC/USD", re: /(?:^|[^a-z])(btc|xbt|bitcoin)(?=usdt|usdc|usd|perp|[^a-z]|$)/i },
  { market: "HSK/USD", re: /(?:^|[^a-z])(hsk|hashkey)(?=usdt|usdc|usd|perp|[^a-z]|$)/i },
];

/** Tickers people post that we can't settle yet: `#ETH/USDT`, `SOLUSDT`, or a few well-known names. */
const OTHER_PAIR = /#([a-z]{2,10})\b|\b([a-z]{2,10})\s*\/\s*(?:usdt|usdc|usd)\b|\b([a-z]{2,10})(?:usdt|usdc)\b/gi;
const KNOWN_OTHER = /\b(eth|ethereum|sol|solana|xrp|doge|bnb|ada|avax|link|dot|ltc|ton|trx|matic|pepe|shib|arb|op|sui|apt|near)\b/i;

const SIDE = /\b(long(?:ing)?|buy(?:ing)?|short(?:ing)?|sell(?:ing)?)\b/i;

type Label = "entry" | "tp" | "sl" | "other";
const LABELS: { kind: Label; re: RegExp }[] = [
  { kind: "entry", re: /\b(?:entry\s*(?:zone|price|range)?|entries|enter(?:\s*at)?|buy\s*(?:zone|range|at)|ep|open\s*at)\b|@/gi },
  { kind: "tp", re: /\b(?:targets?|tgts?|tps?\d*|take\s*-?\s*profits?)\b/gi },
  { kind: "sl", re: /\b(?:stop\s*-?\s*loss|stop|sl|invalidation)\b/gi },
  { kind: "other", re: /\b(?:leverage|lev|margin|risk|cross|isolated|r:r|rr)\b/gi },
];

/** A price: `81500`, `81,500`, `81.5k`, `0.5123`. Not leverage (`10x`), percentages, or durations (`24h`). */
const NUM = /(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(\s?k)?(?![\d.,]*\s*(?:x\b|%|h\b|hrs?\b|hours?\b|d\b|days?\b|m\b|mins?\b))(?![a-z])/gi;
const VALIDITY = /(\d+(?:\.\d+)?)\s*(h|hrs?|hours?|d|days?)\b/i;

function numbersIn(s: string): number[] {
  const out: number[] = [];
  for (const m of s.matchAll(NUM)) {
    const n = Number(`${m[1]!.replace(/,/g, "")}${m[2] ? `.${m[2]}` : ""}`) * (m[3] ? 1000 : 1);
    if (Number.isFinite(n) && n > 0) out.push(n);
  }
  return out;
}

/** Decimal string without float noise (8 dp max, trailing zeros trimmed). */
export function fmt(n: number): string {
  return n.toFixed(8).replace(/\.?0+$/, "");
}

function normalize(text: string): string {
  return (
    text
      .replace(/[‒-―−]/g, "-")
      .replace(/[*_`~]/g, " ")
      // list markers like "1) 82500" or "2. 84000" at line start
      .replace(/^\s*\d{1,2}[).:]\s+/gm, " ")
      // emoji and other symbols become spaces so they don't glue words together
      .replace(/[^\p{L}\p{N}\s.,:@#/%\-+]/gu, " ")
  );
}

export function detectMarket(text: string): { market?: SupportedMarket; other?: string } {
  for (const s of SUPPORTED) if (s.re.test(text)) return { market: s.market };
  for (const m of text.matchAll(OTHER_PAIR)) {
    const t = (m[1] ?? m[2] ?? m[3] ?? "").toUpperCase();
    if (t && !["USDT", "USD", "USDC"].includes(t) && !/^\d/.test(t)) return { other: t };
  }
  const k = text.match(KNOWN_OTHER);
  return k ? { other: k[1]!.toUpperCase() } : {};
}

export function detectSide(text: string): "LONG" | "SHORT" | undefined {
  const m = text.match(SIDE);
  if (!m) return undefined;
  return /^(long|buy)/i.test(m[1]!) ? "LONG" : "SHORT";
}

/** Splits the text into labelled segments: each label owns the text up to the next label. */
function segments(text: string, sideAt: { index: number; end: number } | undefined) {
  const marks: { kind: Label | "side"; index: number; end: number }[] = [];
  for (const l of LABELS) for (const m of text.matchAll(l.re)) marks.push({ kind: l.kind, index: m.index!, end: m.index! + m[0].length });
  if (sideAt) marks.push({ kind: "side", ...sideAt });
  marks.sort((a, b) => a.index - b.index);
  const seg: Record<string, number[][]> = { entry: [], tp: [], sl: [], side: [] };
  marks.forEach((m, i) => {
    if (m.kind === "other") return;
    const next = marks[i + 1]?.index ?? text.length;
    seg[m.kind]!.push(numbersIn(text.slice(m.end, next)));
  });
  return seg as Record<"entry" | "tp" | "sl" | "side", number[][]>;
}

export function parseRules(raw: string): ParseResult {
  const text = normalize(raw);
  const side = detectSide(text);
  const { market, other } = detectMarket(text);
  if (!side || (!market && !other)) return { ok: false, reason: "not_signal", detail: "no market and side" };

  const sideMatch = text.match(SIDE);
  const seg = segments(text, sideMatch ? { index: sideMatch.index!, end: sideMatch.index! + sideMatch[0].length } : undefined);
  const tps = seg.tp.flat();
  const sls = seg.sl.flat();
  const explicitEntry = seg.entry.flat();
  // one-liners: "BTC LONG 81.5k TP ..." – the price right after the side word is the entry
  const entries = explicitEntry.length ? explicitEntry : seg.side.flat();

  // commentary that only names a market and a direction is not a signal
  if (!tps.length && !sls.length) return { ok: false, reason: "not_signal", detail: "no targets or stop" };
  if (!market) return { ok: false, reason: "unsupported_market", detail: other! };

  const missing = [!entries.length && "entry", !tps.length && "take profit", !sls.length && "stop loss"].filter(Boolean);
  if (missing.length) return { ok: false, reason: "incomplete", detail: `missing ${missing.join(", ")}` };

  const notes: string[] = [];
  let entry = entries[0]!;
  if (entries.length > 1) {
    const lo = Math.min(...entries.slice(0, 2));
    const hi = Math.max(...entries.slice(0, 2));
    entry = (lo + hi) / 2;
    notes.push(`entry range ${fmt(lo)}–${fmt(hi)} → midpoint ${fmt(entry)}`);
  }
  if (tps.length > 1) notes.push(`${tps.length} targets: the first (${fmt(tps[0]!)}) is the take profit`);

  const v = text.match(VALIDITY);
  let validHours = DEFAULT_VALID_HOURS;
  if (v) validHours = Number(v[1]) * (/^d/i.test(v[2]!) ? 24 : 1);
  else notes.push(`no expiry given: ${DEFAULT_VALID_HOURS}h`);

  const signal: ParsedSignal = {
    market,
    side,
    entry: fmt(entry),
    takeProfit: fmt(tps[0]!),
    stopLoss: fmt(sls[0]!),
    validHours,
    notes,
  };
  return { ok: true, signal, parser: "rules" };
}
