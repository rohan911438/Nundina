import { contractAddress, toUnits } from "@nundina/shared";
import { revenueRouterAbi } from "@nundina/shared/abis";
import { blend, type Upstream } from "./blend.js";
import { commitProposal } from "./commit.js";
import { decryptPurchase } from "./crypto.js";
import { env } from "./env.js";
import { activityLog } from "./log.js";
import { lastPrice } from "./market.js";
import { Nundina } from "./nundina.js";
import { onboardProvider, topUpBond, type Profile } from "./onboard.js";
import { buy, directPay } from "./pay.js";
import { MAX_DAILY_SPEND, utcDay } from "./policy.js";
import { scoreCache } from "./execution.js";
import { agentWallet, type AgentWallet } from "./wallet.js";

export const AGGREGATOR = { topN: 3, expectedBuyers: 2, markupPct: 20, minPriceUsd: 0.1, maxPriceUsd: 1, dailyBudgetUsd: "3", maxPerSignalUsd: "0.5" };

/** Meta-signal price: above what we paid ÷ expected buyers, within [min, max]. */
export function metaPrice(paidUnits: bigint, cfg = AGGREGATOR): number {
  const perBuyer = Number(paidUnits) / 1e6 / cfg.expectedBuyers;
  const p = Math.ceil(perBuyer * (1 + cfg.markupPct / 100) * 100) / 100;
  return Math.min(cfg.maxPriceUsd, Math.max(cfg.minPriceUsd, p));
}

export const AGGREGATOR_PROFILE: Profile = {
  name: "aggregator",
  type: "aggregator",
  handle: "agg_btc",
  displayName: "BTC Blend (aggregator)",
  bio: "Buys the top 3 live BTC signals by provider score, blends them by score, and resells the blend. 70% of a WIN routes to the upstream providers on-chain.",
  defaultPriceUsd: "0.25",
};

/**
 * Aggregator round (every 2 h): buy the top-N live BTC signals by score, blend, commit the
 * meta-signal with upstream ids and 7000 bps split by weight. `price` is the current BTC price.
 */
export async function aggregatorService(opts: { root?: Nundina; wallet: AgentWallet; profile?: Profile; price?: () => Promise<number> }) {
  const root = opts.root ?? new Nundina();
  const w = opts.wallet;
  const profile = opts.profile ?? AGGREGATOR_PROFILE;
  const { agent } = await onboardProvider(root, w, profile);
  const api = root.as(agent.id);
  const log = activityLog(api, profile.name);
  const score = scoreCache(root, 60_000);
  const price = opts.price ?? (() => lastPrice("BTCUSDT"));
  const escrow = contractAddress(env().CHAIN_ID, "PerformanceEscrow");
  const router = contractAddress(env().CHAIN_ID, "RevenueRouter");
  let fromBlock: bigint | undefined;
  const mine = new Set<string>();
  const enc = (await api.secrets()).encKey!;

  async function round() {
    const me = await api.agent();
    if (me.paused) return log("skip", "paused by owner");
    const live = (await api.liveSignals("BTC/USD")).filter(
      (s) => s.provider && s.provider.handle !== profile.handle && new Date(s.validUntil).getTime() > Date.now() + 30 * 60_000,
    );
    const scored = await Promise.all(live.map(async (s) => ({ s, score: (await score(s.provider!.handle)) ?? 0 })));
    scored.sort((a, b) => b.score - a.score || Number(b.s.id) - Number(a.s.id));
    // one per provider, top N
    const picks: typeof scored = [];
    for (const x of scored) if (picks.length < AGGREGATOR.topN && !picks.some((p) => p.s.provider!.handle === x.s.provider!.handle)) picks.push(x);
    if (picks.length < 2) return log("skip", `only ${picks.length} live BTC signal(s) from other providers; need 2+ to blend`);

    const ups: Upstream[] = [];
    let paid = 0n;
    let spent = toUnits(me.spentTodayUsd);
    for (const { s, score: sc } of picks) {
      try {
        const r = await buy(api, directPay(w), s.id, {
          guard: { perTxCap: toUnits(AGGREGATOR.maxPerSignalUsd), dailyCap: toUnits(AGGREGATOR.dailyBudgetUsd) < MAX_DAILY_SPEND ? toUnits(AGGREGATOR.dailyBudgetUsd) : MAX_DAILY_SPEND, spentToday: spent, recipients: [escrow] },
          beforePay: async () => ((await api.agent()).paused ? "paused before payment" : null),
        });
        if (r.blocked) {
          await log("skip", `upstream #${s.id} blocked: ${r.blocked}`, { signalId: s.id });
          continue;
        }
        if (r.txHash) {
          await api.spend(r.amount);
          spent += r.amount;
          paid += r.amount;
        }
        if (r.status !== "KEY_SENT") {
          await log("error", `upstream #${s.id} payment ended ${r.status}`, { signalId: s.id, purchaseId: r.purchaseId });
          continue;
        }
        const plain = await decryptPurchase(api, enc, r.purchaseId);
        ups.push({ ...plain, score: sc });
        await log("buy", `upstream #${s.id} from @${s.provider!.handle} (score ${sc}): ${plain.side} @ ${plain.entry}`, { signalId: s.id, purchaseId: r.purchaseId });
      } catch (e) {
        await log("skip", `upstream #${s.id}: ${(e as Error).message}`, { signalId: s.id });
      }
    }
    if (ups.length < 2) return log("skip", `bought ${ups.length} upstream(s); need 2+ to blend`);
    const nowS = Math.floor(Date.now() / 1000);
    const b = blend(ups, await price(), nowS);
    if (!b) return log("skip", `upstreams disagree evenly or blend has no valid geometry (${ups.map((u) => u.side).join("/")})`);
    if (b.proposal.validHours < 0.5) return log("skip", "upstreams expire too soon for a meta-signal");
    await topUpBond(w, toUnits(env().AGENT_BOND_USD));
    const priceUsd = metaPrice(paid);
    const { signalId } = await commitProposal(api, w, b.proposal, { priceUsd, upstream: b.upstream, upstreamBps: b.upstreamBps, validHours: b.proposal.validHours });
    mine.add(signalId);
    await log(
      "post",
      `meta ${b.proposal.side} @ ${b.proposal.entry} TP ${b.proposal.takeProfit} SL ${b.proposal.stopLoss}, $${priceUsd} (paid $${(Number(paid) / 1e6).toFixed(2)} upstream); ${b.upstream.map((u, i) => `#${u}: ${b.upstreamBps[i]} bps`).join(", ")}; ${b.proposal.rationale}`,
      { signalId },
    );
  }

  /** Logs RevenueRouter payouts (`Routed`, emitted by RevenueRouter) for our meta-signals. */
  async function watchRoutes() {
    const head = await w.pub.getBlockNumber();
    const from = fromBlock ?? (head > 5_000n ? head - 5_000n : 0n);
    const evs = await w.pub.getContractEvents({ address: router, abi: revenueRouterAbi, eventName: "Routed", fromBlock: from, toBlock: head });
    fromBlock = head + 1n;
    const ours = new Set([...mine, ...(await api.signalsBy(profile.handle)).map((s) => s.id)]);
    for (const e of evs) {
      const id = e.args.id?.toString();
      if (!id || !ours.has(id)) continue;
      const usd = (Number(e.args.amount ?? 0n) / 1e6).toFixed(4);
      const self = e.args.upstreamId?.toString() === id;
      await log("route", self ? `WIN on #${id}: aggregator keeps ${usd} in tx ${e.transactionHash}` : `WIN on #${id}: routed ${usd} to upstream #${e.args.upstreamId} (${e.args.to}) in tx ${e.transactionHash}`, {
        signalId: id,
        fill: { upstreamId: e.args.upstreamId?.toString(), to: e.args.to, amount: e.args.amount?.toString(), tx: e.transactionHash },
      });
    }
    return evs.length;
  }

  return { agentId: agent.id, api, round, watchRoutes, day: () => utcDay(new Date()) };
}

export async function runAggregator(intervalS = 2 * 3600) {
  const { every } = await import("./runner.js");
  const { keyFromEnv } = await import("./wallet.js");
  const svc = await aggregatorService({ wallet: agentWallet(keyFromEnv("aggregator")) });
  console.log(`aggregator: agent #${svc.agentId} wallet ${(await svc.api.secrets()).wallet}`);
  // route watcher every 5 min, blend round every 2 h
  let last = 0;
  await every("aggregator", 300, async () => {
    await svc.watchRoutes();
    if (Date.now() - last >= intervalS * 1000) {
      last = Date.now();
      await svc.round();
    }
  });
}
