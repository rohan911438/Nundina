import { CHAINS } from "@nundina/shared/chain";
import { MARKETS } from "@nundina/shared/signal";
import { config } from "./config";

/**
 * Display helpers. Inputs are the API's decimal strings: money with 6 decimals ("1.500000"),
 * prices with 8 ("81500.00000000" or already trimmed to the market's display decimals).
 */

/** "$1.50", "$1,234.56"; `compact` → "$12.3K". */
export function usd(v: string | number | null | undefined, opts: { compact?: boolean } = {}) {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "—";
  if (opts.compact && Math.abs(n) >= 10_000)
    return `$${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n)}`;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Price in the market's display decimals: BTC 81,500.00, HSK 0.0873. */
export function price(v: string | number | null | undefined, market = "BTC/USD") {
  if (v == null || v === "") return "—";
  const dp = MARKETS[market as keyof typeof MARKETS]?.displayDecimals ?? 2;
  return Number(v).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** "+2.50R", "−1.00R", "0.00R". */
export function r(v: number | null | undefined, dp = 2) {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = Math.abs(v).toFixed(dp);
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${s}R`;
}

/** 0.6342 → "63.4%"; `signed` adds + for gains. */
export function pct(v: number | null | undefined, opts: { dp?: number; signed?: boolean } = {}) {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = (Math.abs(v) * 100).toFixed(opts.dp ?? 1);
  const sign = v < 0 ? "−" : opts.signed && v > 0 ? "+" : "";
  return `${sign}${s}%`;
}

/** A value already in percent (alpha, follower PnL): 1.234 → "+1.2%". */
export function pp(v: number | null | undefined, opts: { dp?: number; signed?: boolean } = {}) {
  return v == null ? "—" : pct(v / 100, { signed: true, ...opts });
}

export function int(v: number | null | undefined) {
  return v == null ? "—" : v.toLocaleString("en-US");
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 86_400],
  ["month", 30 * 86_400],
  ["day", 86_400],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
];
const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "short" });

/** "3 hr. ago", "in 5 min." relative to `now` (ms). */
export function ago(iso: string | Date | null | undefined, now = Date.now()) {
  if (!iso) return "—";
  const diff = Math.round((new Date(iso).getTime() - now) / 1000);
  for (const [unit, secs] of UNITS) {
    if (Math.abs(diff) >= secs || unit === "second") return rtf.format(Math.trunc(diff / secs), unit);
  }
  return "—";
}

/** "26 Oct 2026, 14:05 UTC" — absolute times always in UTC so everyone sees the same commit time. */
export function utc(iso: string | Date | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`;
}

/** "HH:MM UTC" */
export function hhmm(iso: string | Date) {
  return `${new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`;
}

/** 0x1234…abcd */
export function short(hex: string | null | undefined, head = 6, tail = 4) {
  if (!hex) return "—";
  return hex.length <= head + tail + 1 ? hex : `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}

function explorerBase(chainId = config.chainId) {
  return CHAINS[chainId]?.blockExplorers?.default.url ?? "https://hsk.blockscout.com";
}
export const explorer = {
  tx: (hash: string, chainId?: number) => `${explorerBase(chainId)}/tx/${hash}`,
  address: (addr: string, chainId?: number) => `${explorerBase(chainId)}/address/${addr}`,
  token: (addr: string, id: string, chainId?: number) => `${explorerBase(chainId)}/token/${addr}/instance/${id}`,
  /** null when no HSP explorer is configured */
  hsp: (paymentId: string) => (config.hspExplorerUrl ? `${config.hspExplorerUrl.replace(/\/$/, "")}/payments/${paymentId}` : null),
};

export const marketShort = (m: string) => m.split("/")[0] ?? m;

/** Green above zero, red below, muted at exactly zero (often just "no data yet"). */
export const tone = (v: number) => (v > 0 ? "win" : v < 0 ? "loss" : "muted") as "win" | "loss" | "muted";
