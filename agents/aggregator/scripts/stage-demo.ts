/**
 * Pre-stages the demo recording (prompt 15, Part D) on the configured chain (testnet or mainnet):
 *   - a mirrored pair of short-expiry BTC signals from two demo providers: a LONG and a SHORT with
 *     the same tight geometry. Whichever way BTC moves first, one hits TP and the other SL, so a
 *     WIN and a LOSS settle while you record.
 *   - one aggregator round, which buys the live signals and posts a meta-signal with upstream bps.
 *
 *   DEMO_BULL_PRIVATE_KEY=0x… DEMO_BEAR_PRIVATE_KEY=0x… AGENT_AGGREGATOR_PRIVATE_KEY=0x… \
 *   DEMO_EXPIRY_MIN=40 DEMO_MOVE_BPS=25 pnpm --filter @nundina/agent-aggregator stage-demo
 *
 * Wallets need gas + USDT for the bond (AGENT_BOND_USD) and the aggregator's buys. Prints every
 * signal id and its expiry; nothing here is investment advice.
 */
import {
  Nundina,
  aggregatorService,
  agentWallet,
  commitProposal,
  env,
  lastPrice,
  onboardProvider,
  type Profile,
} from "@nundina/agents-core";

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is required`);
  return v as `0x${string}`;
};

const EXPIRY_MIN = Number(process.env.DEMO_EXPIRY_MIN ?? 40);
/** TP distance; SL sits at two thirds of it so R:R is 1.5. */
const MOVE_BPS = Number(process.env.DEMO_MOVE_BPS ?? 25);

const PROFILES: Record<"bull" | "bear", Profile> = {
  bull: { name: "demo-bull", type: "strategy", handle: "demo_bull", displayName: "Demo Bull", bio: "Demo provider for the Nundina walkthrough.", defaultPriceUsd: "0.10" },
  bear: { name: "demo-bear", type: "strategy", handle: "demo_bear", displayName: "Demo Bear", bio: "Demo provider for the Nundina walkthrough.", defaultPriceUsd: "0.10" },
};

async function main() {
  if (EXPIRY_MIN < 31) throw new Error("DEMO_EXPIRY_MIN must be > 30 so the aggregator still buys the pair");
  console.log(`chain ${env().CHAIN_ID}, API ${env().API_URL}, expiry ${EXPIRY_MIN} min, move ${MOVE_BPS} bps`);
  const root = new Nundina();
  const px = await lastPrice("BTCUSDT");
  const tp = (px * MOVE_BPS) / 10_000;
  const sl = (tp * 2) / 3;
  const until = new Date(Date.now() + EXPIRY_MIN * 60_000);

  const posted: string[] = [];
  for (const [side, key, profile] of [
    ["LONG", need("DEMO_BULL_PRIVATE_KEY"), PROFILES.bull],
    ["SHORT", need("DEMO_BEAR_PRIVATE_KEY"), PROFILES.bear],
  ] as const) {
    const w = agentWallet(key);
    const { agent } = await onboardProvider(root, w, profile);
    const dir = side === "LONG" ? 1 : -1;
    const r = await commitProposal(
      root.as(agent.id),
      w,
      { market: "BTC/USD", side, entry: px, takeProfit: px + dir * tp, stopLoss: px - dir * sl, validHours: EXPIRY_MIN / 60, rationale: "Demo signal (mirrored pair)." },
      { priceUsd: 0.1, validHours: EXPIRY_MIN / 60 },
    );
    posted.push(String(r.signalId));
    console.log(`@${profile.handle} #${r.signalId} ${side} BTC around ${px.toFixed(0)}, expires ${until.toISOString()}`);
  }

  const agg = await aggregatorService({ root, wallet: agentWallet(need("AGENT_AGGREGATOR_PRIVATE_KEY")) });
  await agg.round();
  const metas = await agg.api.signalsBy("agg_btc");
  const meta = metas.find((m) => !posted.includes(String(m.id)));
  console.log(meta ? `meta-signal #${meta.id} (upstream ids in its detail page and on-chain)` : "aggregator posted no meta-signal this round (see its activity log)");
  console.log(`\nRecord: buy #${posted.join(" and #")} from the web app or Telegram now; the keeper settles them within ~${EXPIRY_MIN + 15} min.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
