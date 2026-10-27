/**
 * Scripted A2A demo on a local chain (prompt 13 "done when", short-expiry variant):
 *   two upstream providers post BTC LONGs → the aggregator agent buys both, blends, commits a
 *   meta-signal (upstream ids, 7000 bps) → the execution agent (for a test user) buys the meta-signal
 *   → price trades through every TP → the keeper proves, finalizes and settles → RevenueRouter pays
 *   the upstream providers (`Routed`) and the aggregator logs them.
 * Uses the real agent runtime (agents/core) against the API over HTTP with workers and mock HSP.
 *
 *   pnpm --filter @nundina/keeper demo:aggregator
 */
import { createWalletClient, http, parseEther, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const PORT = 8790;
const DB = "postgres://nundina:nundina@localhost:5432/nundina_demo";
const SECRET = "test-internal-secret-0123456789";

Object.assign(process.env, {
  NODE_ENV: "development",
  LOG_LEVEL: process.env.LOG_LEVEL ?? "warn",
  DATABASE_URL: DB,
  TEST_DATABASE_URL: DB,
  KEY_SERVICE_MASTER_KEY: "22".repeat(32),
  INTERNAL_SECRET: SECRET,
  TELEGRAM_BOT_TOKEN: "123456:TEST_TOKEN",
  CHAIN_ID: "31337",
  HSP_MODE: "mock",
  RUN_WORKERS: "true",
  PORT: String(PORT),
  API_URL: `http://localhost:${PORT}`,
  AGENT_BOND_USD: "5",
});

const step = (s: string) => console.log(`\n── ${s}`);

async function main() {
  const { default: setupDb } = await import("../../api/test/globalSetup.js");
  await setupDb();
  const { startChain, keys } = await import("../../api/test/chain.js");
  const chain = await startChain();
  const { serve } = await import("@hono/node-server");
  const { createApp } = await import("../../api/src/app.js");
  const { startWorkers } = await import("../../api/src/jobs/workers.js");
  const { initPaymentRail } = await import("../../api/src/payments/index.js");
  const { makeProvider, INTERNAL, postJson } = await import("../../api/test/helpers.js");
  const { db } = await import("../../api/src/db/client.js");
  const { users } = await import("../../api/src/db/schema.js");
  const { MARKETS, contractAddress, toPrice } = await import("@nundina/shared");
  const { mockPriceAdapterAbi, revenueRouterAbi } = await import("@nundina/shared/abis");
  const { addresses, chainNow, readSignal } = await import("../src/chain.js");
  const { Keeper } = await import("../src/keeper.js");
  const { Metrics } = await import("../src/metrics.js");
  const { MockOracle } = await import("../src/oracle/mock.js");
  const { PriceHistory } = await import("../src/history.js");
  const { KeeperApi } = await import("../src/state.js");
  const { TxSender } = await import("../src/tx.js");
  await initPaymentRail();
  await startWorkers();
  const server = serve({ fetch: createApp().fetch, port: PORT });
  // agents read env lazily: import after the chain set LOCAL_RPC_URL
  const core = await import("@nundina/agents-core");

  const a = addresses(31337);
  const BTC = MARKETS["BTC/USD"].id;
  const keeperAccount = privateKeyToAccount(keys.KEEPER_PRIVATE_KEY as Hex);
  await chain.testClient.setBalance({ address: keeperAccount.address, value: parseEther("100") });
  const kw = createWalletClient({ account: keeperAccount, chain: chain.pub.chain!, transport: http(chain.rpc) });
  const now = () => chainNow(chain.pub as any);
  const push = async (price: string) =>
    chain.pub.waitForTransactionReceipt({ hash: await kw.writeContract({ address: a.pushAdapter, abi: mockPriceAdapterAbi, functionName: "push", args: [BTC, toPrice(price), BigInt(await now())] }) });

  step("upstream providers post");
  await push("81500");
  const ups = [] as { handle: string; payout: Hex; id: bigint }[];
  for (const [handle, levels] of [
    ["up_alpha", { side: "LONG" as const, entry: "81500", takeProfit: "83000", stopLoss: "80800" }],
    ["up_beta", { side: "LONG" as const, entry: "81500", takeProfit: "83500", stopLoss: "80700" }],
  ] as const) {
    const acct = privateKeyToAccount(generatePrivateKey());
    await chain.registerProvider(acct, { bondUsd: "10" });
    const p = await makeProvider({ address: acct.address, handle });
    const { signalId } = await chain.commitViaApi(acct, p.userId, 300_000n, levels);
    ups.push({ handle, payout: acct.address, id: signalId });
    console.log(`@${handle} #${signalId} ${levels.side} ${levels.entry} TP ${levels.takeProfit} SL ${levels.stopLoss} at $0.30`);
  }

  step("aggregator agent: onboard, buy top signals, blend, commit");
  const aggKey = generatePrivateKey();
  await chain.fund(privateKeyToAccount(aggKey), "10");
  const agg = await core.aggregatorService({ wallet: core.agentWallet(aggKey), price: async () => 81_500 });
  await agg.round();
  const aggSignals = await agg.api.signalsBy("agg_btc");
  const meta = aggSignals[0];
  if (!meta) throw new Error("aggregator posted no meta-signal (see activity above)");
  console.log(`meta-signal #${meta.id} upstream ${JSON.stringify(meta.upstream)}`);

  step("execution agent buys the meta-signal for a test user");
  const [u] = await db().insert(users).values({ wallet: privateKeyToAccount(generatePrivateKey()).address.toLowerCase() }).returning();
  const created = await postJson("/agents", { name: "Demo follower", policy: { dailyBudgetUsd: "2", maxPerSignalUsd: "1", providersAllow: ["agg_btc"] } }, { ...INTERNAL, "x-act-as-user": String(u!.id) });
  if (created.status !== 201) throw new Error(`agent create failed: ${JSON.stringify(created.body)}`);
  const exec = created.body.agent;
  const secrets = await new core.Nundina(exec.id).secrets();
  await chain.fund(privateKeyToAccount(secrets.walletKey!), "3");
  const svc = core.executionService();
  await svc.tick();
  const act = await new core.Nundina(exec.id).recentActivity();
  console.log(act.items.map((x) => `  ${x.decision} #${x.signalId}: ${x.reason}`).join("\n"));
  if (!act.items.some((x) => x.decision === "buy" && x.signalId === meta.id)) throw new Error("execution agent did not buy the meta-signal");

  step("price trades through every TP; keeper proves, finalizes, settles");
  const tx = new TxSender(chain.pub as any, kw as any, 1000, () => {});
  const history = new PriceHistory();
  const keeper = new Keeper(chain.pub as any, a, new KeeperApi(`http://localhost:${PORT}`, SECRET), tx, new MockOracle(chain.pub as any, tx, a.pushAdapter, history, 60), history, new Metrics(), (level, msg, extra) => console.log(`keeper ${level}: ${msg} ${extra ? JSON.stringify(extra, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) : ""}`), { proofRetryMs: 0 });
  await keeper.sync();
  keeper.onTrade("BTC/USD", toPrice("84200"), await now());
  const ids = [...ups.map((x) => x.id), BigInt(meta.id)];
  for (let i = 0; ; i++) {
    const st = await Promise.all(ids.map((id) => readSignal(chain.pub as any, a, id)));
    if (st.every((s) => s.resolver.pendingTs > 0)) break;
    // the mock feed takes one round per timestamp: keep the tape moving so each signal gets its proof
    await chain.testClient.mine({ blocks: 1 });
    keeper.onTrade("BTC/USD", toPrice("84200"), await now());
    if (i > 60) throw new Error(`touches not proven: ${JSON.stringify(st.map((s) => s.resolver), (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  await chain.testClient.setNextBlockTimestamp({ timestamp: BigInt((await now()) + 601) });
  await chain.testClient.mine({ blocks: 1 });
  const fromBlock = await chain.pub.getBlockNumber();
  await keeper.runAll();
  await keeper.runAll();
  for (const id of ids) {
    const s = await readSignal(chain.pub as any, a, id);
    console.log(`#${id}: ${s.outcome} ${s.pot}`);
  }

  step("RevenueRouter payouts");
  const evs = await chain.pub.getContractEvents({ address: contractAddress(31337, "RevenueRouter"), abi: revenueRouterAbi, eventName: "Routed", fromBlock });
  for (const e of evs) console.log(`Routed meta #${e.args.id} → upstream #${e.args.upstreamId} ${e.args.to} $${(Number(e.args.amount) / 1e6).toFixed(4)} (tx ${e.transactionHash})`);
  const n = await agg.watchRoutes();
  const paidTo = new Set(evs.map((e) => e.args.to!.toLowerCase()));
  const ok = evs.length >= 2 && ups.every((x) => paidTo.has(x.payout.toLowerCase()));
  console.log(`\naggregator saw ${n} Routed event(s); upstream providers paid: ${ok ? "yes" : "NO"}`);

  server.close();
  chain.stop();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
