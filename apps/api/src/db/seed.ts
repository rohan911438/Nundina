/**
 * Demo data so the frontend can be built against real-looking numbers:
 * 5 providers, 60 settled signals (+ a few live ones), purchases, settlements, scores, shadow channels.
 * Idempotent: removes earlier seed rows first. Seed signal ids start at 1_000_001 so they never
 * collide with on-chain ids on a dev chain.
 *   pnpm --filter api db:seed
 */
import { fileURLToPath } from "node:url";
import { inArray, eq, sql as dsql } from "drizzle-orm";
import { keccak256, toHex } from "viem";
import { MARKETS, Side, toPrice } from "@nundina/shared";
import { closeDb, db } from "./client.js";
import {
  agentActions,
  keyDeliveries,
  providerScores,
  providers,
  purchases,
  settlements,
  shadowCalls,
  shadowChannels,
  signals,
  users,
} from "./schema.js";
import { log } from "../lib/log.js";
import { recomputeProvider } from "../jobs/scoring.js";

const SEED_ID_BASE = 1_000_000n;
const DAY = 86_400_000;

/** Deterministic PRNG (mulberry32) so every seed run produces the same data. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PROVIDERS = [
  { handle: "satoshi_signals", displayName: "Satoshi Signals", kind: "human", winP: 0.64, n: 32, verified: true, price: "2000000", bio: "BTC swing trades. 1:2 minimum. Every call committed on-chain." },
  { handle: "hk_alpha", displayName: "HK Alpha Desk", kind: "human", winP: 0.55, n: 12, verified: true, price: "1500000", bio: "Hong Kong session scalps on BTC and HSK." },
  { handle: "momentum_bot", displayName: "Momentum Agent", kind: "agent", winP: 0.52, n: 8, verified: false, price: "500000", bio: "Strategy agent: 4h breakout + volume filter." },
  { handle: "mean_revert", displayName: "Mean Revert Agent", kind: "agent", winP: 0.47, n: 5, verified: false, price: "500000", bio: "Strategy agent: fades 2σ moves." },
  { handle: "consensus", displayName: "Consensus Aggregator", kind: "aggregator", winP: 0.6, n: 3, verified: false, price: "3000000", bio: "Buys the top providers' signals and only posts when they agree." },
] as const;


export async function seed() {
  const d = db();
  const r = rng(177);
  const handles = PROVIDERS.map((p) => p.handle);

  // ── cleanup (children first)
  const oldSignals = d.select({ id: signals.id }).from(signals).where(eq(signals.source, "seed"));
  const oldPurchases = d.select({ id: purchases.id }).from(purchases).where(inArray(purchases.signalId, oldSignals));
  await d.delete(keyDeliveries).where(inArray(keyDeliveries.purchaseId, oldPurchases));
  await d.delete(agentActions).where(inArray(agentActions.signalId, oldSignals));
  await d.delete(purchases).where(inArray(purchases.signalId, oldSignals));
  await d.delete(settlements).where(inArray(settlements.signalId, oldSignals));
  await d.delete(signals).where(eq(signals.source, "seed"));
  const oldProviders = d.select({ id: providers.id }).from(providers).where(inArray(providers.handle, handles));
  await d.delete(providerScores).where(inArray(providerScores.providerId, oldProviders));
  await d.delete(providers).where(inArray(providers.handle, handles));
  await d.delete(shadowCalls);
  await d.delete(shadowChannels);

  // ── buyers
  const buyerWallets = Array.from({ length: 8 }, (_, i) => `0x${"b".repeat(39)}${i}`);
  const buyers = await d
    .insert(users)
    .values(buyerWallets.map((wallet) => ({ wallet })))
    .onConflictDoUpdate({ target: users.wallet, set: { wallet: dsql`excluded.wallet` } })
    .returning({ id: users.id, wallet: users.wallet });

  // ── providers
  const now = Date.now();
  const provRows = await d
    .insert(providers)
    .values(
      PROVIDERS.map((p, i) => ({
        handle: p.handle,
        displayName: p.displayName,
        bio: p.bio,
        address: keccak256(toHex(`seed-provider-${p.handle}`)).slice(0, 42),
        payoutAddr: keccak256(toHex(`seed-payout-${p.handle}`)).slice(0, 42),
        erc8004Id: String(100 + i),
        kind: p.kind,
        isAgent: p.kind !== "human",
        defaultPrice: p.price,
        bondTotal: String(50_000_000 + i * 25_000_000),
        bondLocked: String(5_000_000 * (i + 1)),
        kycUntil: p.verified ? new Date(now + 180 * DAY) : null,
        channelTitle: p.kind === "human" ? `${p.displayName} VIP` : null,
        registeredOnChain: true,
        createdAt: new Date(now - (60 - i * 5) * DAY),
      })),
    )
    .returning();

  // ── 60 settled signals, spread over the last 45 days
  let nextId = SEED_ID_BASE + 1n;
  type SigRow = typeof signals.$inferInsert;
  const sigRows: SigRow[] = [];
  const settleRows: (typeof settlements.$inferInsert)[] = [];
  const purchaseRows: (typeof purchases.$inferInsert)[] = [];
  const results: Record<number, { outcome: string; r: number; at: number; market: string }[]> = {};

  for (const [pi, spec] of PROVIDERS.entries()) {
    const prov = provRows[pi]!;
    results[prov.id] = [];
    for (let k = 0; k < spec.n; k++) {
      const id = nextId++;
      const market = r() < 0.75 ? "BTC/USD" : "HSK/USD";
      const base = market === "BTC/USD" ? 81_500 * (0.9 + r() * 0.2) : 0.0873 * (0.85 + r() * 0.3);
      const side = r() < 0.6 ? Side.LONG : Side.SHORT;
      const riskPct = 0.006 + r() * 0.012;
      const rr = 1.5 + Math.round(r() * 3) / 2; // 1.5..3.0
      const dir = side === Side.LONG ? 1 : -1;
      const entry = base;
      const sl = entry * (1 - dir * riskPct);
      const tp = entry * (1 + dir * riskPct * rr);
      const roll = r();
      const outcome = roll < 0.05 ? "VOID" : roll < 0.05 + spec.winP * 0.95 ? "WIN" : "LOSS";
      const rMult = outcome === "WIN" ? rr : outcome === "LOSS" ? -1 : 0;
      const committedAt = now - (45 - (k * 44) / spec.n) * DAY - r() * DAY * 0.5;
      const decidedAt = committedAt + (2 + r() * 30) * 3600_000;
      const fmt = (v: number) => toPrice(v.toFixed(market === "BTC/USD" ? 2 : 6)).toString();
      const price = BigInt(spec.price);
      const nBuyers = Math.floor(r() * 6);

      sigRows.push({
        id,
        providerId: prov.id,
        commitHash: keccak256(toHex(`seed-commit-${id}`)),
        market,
        marketId: MARKETS[market].id,
        side,
        entry: fmt(entry),
        tp: fmt(tp),
        sl: fmt(sl),
        validUntil: new Date(committedAt + 2 * DAY),
        committedAt: new Date(committedAt),
        price: price.toString(),
        oraclePrice: fmt(entry * (1 + (r() - 0.5) * 0.002)),
        isLimit: false,
        status: outcome === "LOSS" && r() < 0.5 ? "REFUNDED" : "SETTLED",
        outcome,
        rMultiple: rMult.toFixed(2),
        upstreamJson:
          spec.kind === "aggregator" && sigRows.length > 3
            ? [
                { id: sigRows[sigRows.length - 2]!.id!.toString(), bps: 2000 },
                { id: sigRows[sigRows.length - 4]!.id!.toString(), bps: 1500 },
              ]
            : [],
        commitTx: keccak256(toHex(`seed-tx-commit-${id}`)),
        revealTx: keccak256(toHex(`seed-tx-reveal-${id}`)),
        resolveTx: keccak256(toHex(`seed-tx-resolve-${id}`)),
        revealedAt: new Date(decidedAt + 600_000),
        decidedAt: new Date(decidedAt),
        purchaseCount: nBuyers,
        source: "seed",
        createdAt: new Date(committedAt),
      });

      const gross = price * BigInt(nBuyers);
      settleRows.push({
        signalId: id,
        outcome,
        proofTx: keccak256(toHex(`seed-tx-proof-${id}`)),
        settleTx: keccak256(toHex(`seed-tx-settle-${id}`)),
        payout: outcome === "WIN" ? ((gross * 95n) / 100n).toString() : "0",
        fee: outcome === "WIN" ? ((gross * 5n) / 100n).toString() : "0",
        refundsTotal: outcome === "WIN" ? "0" : gross.toString(),
        slashTotal: outcome === "LOSS" ? ((gross * 20n) / 100n).toString() : "0",
        settledAt: new Date(decidedAt + 3600_000),
      });
      for (let b = 0; b < nBuyers; b++) {
        const buyer = buyers[(Number(id) + b) % buyers.length]!;
        purchaseRows.push({
          signalId: id,
          buyerUserId: buyer.id,
          buyerAddress: buyer.wallet!,
          amount: price.toString(),
          token: "USDT",
          rail: "hsp",
          hspPaymentId: `seed-pay-${id}-${b}`,
          status: outcome === "WIN" ? "SETTLED_WIN" : "REFUNDED",
          createdAt: new Date(committedAt + 600_000),
        });
      }
      results[prov.id]!.push({ outcome, r: rMult, at: decidedAt, market });
    }
  }

  // ── a few live (committed, unrevealed) signals for the feed
  for (const [pi, prov] of provRows.slice(0, 4).entries()) {
    const id = nextId++;
    const committedAt = now - (pi + 1) * 3600_000;
    sigRows.push({
      id,
      providerId: prov.id,
      commitHash: keccak256(toHex(`seed-commit-${id}`)),
      market: pi === 3 ? "HSK/USD" : "BTC/USD",
      marketId: MARKETS[pi === 3 ? "HSK/USD" : "BTC/USD"].id,
      validUntil: new Date(committedAt + DAY),
      committedAt: new Date(committedAt),
      price: prov.defaultPrice,
      oraclePrice: pi === 3 ? toPrice("0.0873").toString() : toPrice("81500").toString(),
      status: "COMMITTED",
      commitTx: keccak256(toHex(`seed-tx-commit-${id}`)),
      purchaseCount: pi + 1,
      source: "seed",
      createdAt: new Date(committedAt),
    });
  }

  await d.insert(signals).values(sigRows);
  await d.insert(settlements).values(settleRows);
  if (purchaseRows.length) await d.insert(purchases).values(purchaseRows);

  // ── scores, computed by the same engine the API uses (packages/shared/src/scoring)
  for (const prov of provRows) await recomputeProvider(prov.id, { fetchPrices: false, now });

  // ── shadow (observed) channels
  const chans = await d
    .insert(shadowChannels)
    .values([
      { username: "whale_calls_vip", title: "Whale Calls VIP", lastScrapedAt: new Date() },
      { username: "btc_moon_signals", title: "BTC Moon Signals", lastScrapedAt: new Date() },
    ])
    .returning();
  const calls: (typeof shadowCalls.$inferInsert)[] = [];
  for (const [ci, ch] of chans.entries()) {
    for (let k = 0; k < 20; k++) {
      const win = r() < (ci === 0 ? 0.35 : 0.5);
      calls.push({
        channelId: ch.id,
        messageId: 1000 + k,
        postedAt: new Date(now - (40 - k * 2) * DAY),
        rawText: `BTC ${win ? "LONG" : "SHORT"} entry ${(80_000 + k * 100).toFixed(0)} TP ${(82_000 + k * 100).toFixed(0)} SL ${(79_000 + k * 100).toFixed(0)}`,
        outcome: win ? "WIN" : "LOSS",
        rMultiple: win ? "2.00" : "-1.00",
      });
    }
  }
  await d.insert(shadowCalls).values(calls);

  const settled = sigRows.filter((s) => s.outcome).length;
  log.info({ providers: provRows.length, settled, live: sigRows.length - settled, purchases: purchaseRows.length }, "seeded");
  return { providers: provRows.length, settled, live: sigRows.length - settled };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  seed()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(closeDb);
}
