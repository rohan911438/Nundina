/**
 * Execution-agent policy, as pure functions: every buy or skip comes with the reason, and the same
 * rules feed SpendGuard when the HSP MCP path is live.
 */

export interface Policy {
  /** 6-decimal units. */
  dailyBudget?: string;
  maxPerSignal?: string;
  minScore?: number;
  markets?: string[];
  providersAllow?: string[];
  providersDeny?: string[];
}

export interface Candidate {
  signalId: string;
  market: string;
  /** 6-decimal units. */
  price: bigint;
  providerHandle: string;
  /** null while the provider is in probation (no score yet). */
  providerScore: number | null;
  /** Buyers the provider's bond still covers; null if unknown. */
  capacity: bigint | null;
}

export interface AgentState {
  paused: boolean;
  /** 6-decimal units spent on `spentDay`. */
  spentToday: bigint;
  /** YYYY-MM-DD (UTC) the counter belongs to, or null. */
  spentDay: string | null;
  bought: Set<string>;
}

export type Decision = { buy: true; reason: string } | { buy: false; reason: string };

/** Hard cap in code, on top of the user's policy and SpendGuard (6-dec units). */
export const MAX_DAILY_SPEND = 50_000_000n;

export const utcDay = (d: Date) => d.toISOString().slice(0, 10);
const usd = (u: bigint) => `$${(Number(u) / 1e6).toFixed(2)}`;

/** Today's spend, counting only if the counter is from today (resets at UTC midnight). */
export function spentToday(s: Pick<AgentState, "spentToday" | "spentDay">, now: Date): bigint {
  return s.spentDay === utcDay(now) ? s.spentToday : 0n;
}

export function decide(p: Policy, s: AgentState, c: Candidate, now: Date, hardCap = MAX_DAILY_SPEND): Decision {
  const skip = (reason: string): Decision => ({ buy: false, reason });
  if (s.paused) return skip("paused");
  if (s.bought.has(c.signalId)) return skip("already bought");
  if (p.markets?.length && !p.markets.includes(c.market)) return skip(`market ${c.market} not in policy`);
  const handle = c.providerHandle.toLowerCase();
  if (p.providersDeny?.some((h) => h.toLowerCase() === handle)) return skip(`@${handle} is on the deny list`);
  if (p.providersAllow?.length && !p.providersAllow.some((h) => h.toLowerCase() === handle)) return skip(`@${handle} is not on the allow list`);
  const min = p.minScore ?? 0;
  if (min > 0 && c.providerScore == null) return skip(`@${handle} has no score yet (probation)`);
  if (c.providerScore != null && c.providerScore < min) return skip(`score ${c.providerScore} < ${min}`);
  if (p.maxPerSignal != null && c.price > BigInt(p.maxPerSignal)) return skip(`price ${usd(c.price)} > cap ${usd(BigInt(p.maxPerSignal))}`);
  const spent = spentToday(s, now);
  if (p.dailyBudget != null && spent + c.price > BigInt(p.dailyBudget))
    return skip(`daily budget: ${usd(spent)} spent + ${usd(c.price)} > ${usd(BigInt(p.dailyBudget))}`);
  if (spent + c.price > hardCap) return skip(`hard cap ${usd(hardCap)}/day reached`);
  if (c.capacity != null && c.capacity < 1n) return skip("provider bond has no capacity left");
  return {
    buy: true,
    reason: `score ${c.providerScore ?? "—"} ≥ ${min}, ${usd(c.price)} ≤ cap, ${usd(spent + c.price)} of ${p.dailyBudget ? usd(BigInt(p.dailyBudget)) : "∞"} today`,
  };
}
