import { contractAddress, toUnits } from "@nundina/shared";
import { decryptPurchase } from "./crypto.js";
import { env } from "./env.js";
import { activityLog } from "./log.js";
import { ApiError, Nundina, type AgentView, type SignalView } from "./nundina.js";
import { directPay, buy, type SpendGuard } from "./pay.js";
import { MAX_DAILY_SPEND, decide, utcDay, type Candidate, type Policy } from "./policy.js";
import { agentWallet } from "./wallet.js";
import type { Hex } from "viem";

/** Converts the API's USD-string policy into the unit policy `decide` evaluates. */
export function unitPolicy(v: AgentView["policy"]): Policy {
  return {
    dailyBudget: v.dailyBudgetUsd ? toUnits(v.dailyBudgetUsd).toString() : undefined,
    maxPerSignal: v.maxPerSignalUsd ? toUnits(v.maxPerSignalUsd).toString() : undefined,
    minScore: v.minScore ?? undefined,
    markets: v.markets,
    providersAllow: v.providersAllow,
    providersDeny: v.providersDeny,
  };
}

/** SpendGuard from the same policy: per-tx cap, daily cap (never above the hard cap), escrow only. */
export function spendGuard(p: Policy, spentToday: bigint): SpendGuard {
  const daily = p.dailyBudget ? BigInt(p.dailyBudget) : MAX_DAILY_SPEND;
  return {
    perTxCap: p.maxPerSignal ? BigInt(p.maxPerSignal) : MAX_DAILY_SPEND,
    dailyCap: daily < MAX_DAILY_SPEND ? daily : MAX_DAILY_SPEND,
    spentToday,
    recipients: [contractAddress(env().CHAIN_ID, "PerformanceEscrow")],
  };
}

type Secrets = { walletKey: Hex; encKey: string };

/** Scores change slowly; cache per handle for a few minutes. */
export function scoreCache(api: Nundina, ttlMs = 5 * 60_000) {
  const m = new Map<string, { at: number; score: number | null }>();
  return async (handle: string) => {
    const hit = m.get(handle);
    if (hit && Date.now() - hit.at < ttlMs) return hit.score;
    const p = await api.provider(handle).catch(() => null);
    const score = p?.score.probation ? null : (p?.score.score ?? null);
    m.set(handle, { at: Date.now(), score });
    return score;
  };
}

/**
 * The execution agent: one process serving every user's agent. Each tick, for each unpaused agent,
 * every live signal gets a decision with its reason; buys pay from the agent's own wallet, re-check
 * pause right before money moves, record the spend, then decrypt with the agent key.
 */
export function executionService(root = new Nundina()) {
  const secrets = new Map<number, Secrets>();
  const bought = new Map<number, Set<string>>();
  /** Last skip reason logged per agent+signal, so a 60 s loop doesn't repeat itself. */
  const lastSkip = new Map<string, string>();
  const score = scoreCache(root);

  async function boughtSet(api: Nundina, id: number) {
    let s = bought.get(id);
    if (!s) {
      const recent = await api.recentActivity().catch(() => ({ items: [] }));
      s = new Set(recent.items.filter((x) => x.decision === "buy" && x.signalId).map((x) => x.signalId!));
      bought.set(id, s);
    }
    return s;
  }

  async function secretsFor(api: Nundina, id: number) {
    let s = secrets.get(id);
    if (!s) {
      const r = await api.secrets();
      if (!r.walletKey || !r.encKey) throw new Error(`agent #${id} has no sealed keys`);
      s = { walletKey: r.walletKey, encKey: r.encKey };
      secrets.set(id, s);
    }
    return s;
  }

  async function serve(ag: AgentView, live: SignalView[]) {
    const api = root.as(ag.id);
    const log = activityLog(api, `execution#${ag.id}`);
    const set = await boughtSet(api, ag.id);
    const policy = unitPolicy(ag.policy);
    for (const s of live) {
      if (set.has(s.id) || !s.provider) continue;
      const fresh = await api.agent(); // pause and spend are re-read every decision
      const now = new Date();
      const c: Candidate = {
        signalId: s.id,
        market: s.market,
        price: toUnits(s.priceUsd),
        providerHandle: s.provider.handle,
        providerScore: await score(s.provider.handle),
        capacity: null,
      };
      const state = { paused: fresh.paused, spentToday: toUnits(fresh.spentTodayUsd), spentDay: utcDay(now), bought: set };
      const d = decide(policy, state, c, now);
      if (!d.buy) {
        if (fresh.paused) return; // nothing else to decide for a paused agent
        const k = `${ag.id}:${s.id}`;
        if (lastSkip.get(k) !== d.reason) {
          lastSkip.set(k, d.reason);
          await log("skip", d.reason, { signalId: s.id });
        }
        continue;
      }
      const sec = await secretsFor(api, ag.id);
      const w = agentWallet(sec.walletKey);
      try {
        const r = await buy(api, directPay(w), s.id, {
          guard: spendGuard(policy, state.spentToday),
          beforePay: async () => ((await api.agent()).paused ? "paused before payment" : null),
        });
        if (r.blocked) {
          await log("skip", `blocked before payment: ${r.blocked}`, { signalId: s.id, purchaseId: r.purchaseId });
          continue;
        }
        if (r.txHash) await api.spend(r.amount); // money moved, count it even if the API later rejects
        if (r.status !== "KEY_SENT" && r.status !== "SETTLED_WIN") {
          await log("error", `payment ended ${r.status}`, { signalId: s.id, purchaseId: r.purchaseId });
          set.add(s.id);
          continue;
        }
        set.add(s.id);
        const plain = await decryptPurchase(api, sec.encKey, r.purchaseId);
        await log("buy", `${d.reason}. Unlocked: ${plain.side} @ ${plain.entry} TP ${plain.takeProfit} SL ${plain.stopLoss}`, { signalId: s.id, purchaseId: r.purchaseId });
        if (ag.policy.autoTrade) {
          // TODO(confirm): HSKSwap router; until then fills are simulated at the oracle price and labelled so
          const px = Number(s.oraclePriceAtCommit ?? plain.entry);
          await log("trade", `simulated ${plain.side} fill at ${px} (slippage cap ${ag.policy.slippageBps} bps)`, {
            signalId: s.id,
            purchaseId: r.purchaseId,
            fill: { simulated: true, side: plain.side, price: px, slippageBps: ag.policy.slippageBps, at: new Date().toISOString() },
          });
        }
      } catch (e) {
        const msg = e instanceof ApiError ? `${e.code}: ${e.message}` : (e as Error).message;
        if (e instanceof ApiError && e.code === "already_bought") set.add(s.id);
        const k = `${ag.id}:${s.id}`;
        if (lastSkip.get(k) !== msg) {
          lastSkip.set(k, msg);
          await log(e instanceof ApiError && e.status < 500 ? "skip" : "error", msg, { signalId: s.id });
        }
      }
    }
  }

  return {
    async tick() {
      const [list, live] = await Promise.all([root.agents("execution"), root.liveSignals()]);
      const open = live.filter((s) => new Date(s.validUntil) > new Date());
      for (const ag of list) {
        await serve(ag, open).catch((e) => console.error(`execution#${ag.id}: ${(e as Error).message}`));
      }
      return { agents: list.length, signals: open.length };
    },
  };
}
