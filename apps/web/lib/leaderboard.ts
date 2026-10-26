import type { ProvidersFilter } from "./api";

/** Leaderboard filters live in the URL; this parses and normalises them (unknown values → defaults). */
export const PERIODS = ["7d", "30d", "all"] as const;
export const TYPES = ["human", "agent", "aggregator"] as const;
export const MARKET_OPTIONS = ["BTC/USD", "HSK/USD"] as const;
export const SORTS = ["score", "wilson", "expectancy", "alpha", "n", "pnl"] as const;

export type Search = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const pick = <T extends string>(v: string | undefined, allowed: readonly T[]) => (allowed.includes(v as T) ? (v as T) : undefined);

export function parseFilters(sp: Search) {
  return {
    market: pick(one(sp.market), MARKET_OPTIONS),
    period: pick(one(sp.period), PERIODS) ?? "30d",
    type: pick(one(sp.type), TYPES),
    verified: one(sp.verified) === "1",
    observed: one(sp.observed) === "1",
    sort: pick(one(sp.sort), SORTS) ?? "score",
  } satisfies ProvidersFilter;
}
export type Filters = ReturnType<typeof parseFilters>;

/** URL query for a filter set, leaving defaults out so links stay short. */
export function filterQuery(f: Partial<Filters>) {
  const p = new URLSearchParams();
  if (f.market) p.set("market", f.market);
  if (f.period && f.period !== "30d") p.set("period", f.period);
  if (f.type) p.set("type", f.type);
  if (f.verified) p.set("verified", "1");
  if (f.observed) p.set("observed", "1");
  if (f.sort && f.sort !== "score") p.set("sort", f.sort);
  const s = p.toString();
  return s ? `?${s}` : "";
}
