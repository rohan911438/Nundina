/**
 * Keeper entry point: exchange feeds → touch watcher, periodic loops, /health on KEEPER_PORT.
 *   finalizer + challenges 30 s · expiry 60 s · settler 30 s · unrevealed + refund sweeps 10 min
 */
import { createServer } from "node:http";
import { createPublicClient, createWalletClient, formatEther, http, nonceManager, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainById } from "@nundina/shared";
import { addresses } from "./chain.js";
import { env, rpcUrl } from "./env.js";
import { backfill, binanceTrades, gateTrades } from "./feeds/binance.js";
import { PriceHistory } from "./history.js";
import { Keeper, type Log } from "./keeper.js";
import { Metrics } from "./metrics.js";
import { LiveOracle } from "./oracle/live.js";
import { MockOracle } from "./oracle/mock.js";
import type { Oracle } from "./oracle/types.js";
import { SupraProofClient } from "./proofs/supra.js";
import { KeeperApi } from "./state.js";
import { TxSender } from "./tx.js";

const e = env();
const log: Log = (level, msg, extra) => console[level](JSON.stringify({ level, msg, ...extra, time: new Date().toISOString() }));

const chain = chainById(e.CHAIN_ID);
const transport = http(rpcUrl(e), { timeout: 15_000 });
const pub = createPublicClient({ chain, transport });
const account = privateKeyToAccount(e.KEEPER_PRIVATE_KEY as `0x${string}`, { nonceManager });
const wallet = createWalletClient({ account, chain, transport });
const a = addresses(e.CHAIN_ID);
const tx = new TxSender(pub as any, wallet, e.KEEPER_MAX_GWEI, log);
const history = new PriceHistory();
const metrics = new Metrics();
// mainnet uses the real oracles; local anvil and testnet deploy MockPriceAdapter (keeper = updater)
const oracle: Oracle =
  e.CHAIN_ID === 177
    ? new LiveOracle(pub as any, a.touchVerifier, e.SUPRA_PROOF_API_URL ? new SupraProofClient(e.SUPRA_PROOF_API_URL) : null)
    : new MockOracle(pub as any, tx, a.pushAdapter, history, e.KEEPER_PUSH_INTERVAL_S);
const keeper = new Keeper(pub as any, a, new KeeperApi(e.API_URL, e.INTERNAL_SECRET), tx, oracle, history, metrics, log);
/** 960 one-minute candles: inside both exchanges' 1000-per-request limit. */
const BACKFILL_S = 960 * 60;
/** How long the primary exchange must be silent before a market falls back to its backup venue. */
const PRIMARY_SILENT_MS = 30_000;
const startedAt = Date.now();
const minBalance = parseEther(String(e.KEEPER_MIN_BALANCE_HSK));

function every(ms: number, fn: () => Promise<unknown>) {
  let running = false;
  const run = async () => {
    if (running) return; // never overlap a slow pass
    running = true;
    try {
      await fn();
    } finally {
      running = false;
    }
  };
  void run();
  return setInterval(run, ms);
}

async function main() {
  log("info", "keeper starting", { chainId: e.CHAIN_ID, keeper: account.address, oracle: oracle.kind });
  // catch up after downtime: the last 16 h of 1-minute candles (one request per market)
  const unfilled = await backfill(Math.floor(Date.now() / 1000) - BACKFILL_S, (m, lo, hi, ts) => history.addRange(m, lo, hi, ts)).catch((err) => {
    log("warn", "backfill failed", { error: (err as Error).message });
    return [];
  });
  if (unfilled.length) log("warn", "backfill: no venue reachable", { markets: unfilled });
  await keeper.runAll();

  // a backup venue's trades count only while the primary venue has been silent for that market
  const lastPrimary = new Map<string, number>();
  const onTrade = (m: string, p: bigint, ts: number, primary: boolean) => {
    if (primary) lastPrimary.set(m, Date.now());
    else if (Date.now() - (lastPrimary.get(m) ?? 0) < PRIMARY_SILENT_MS) return;
    keeper.onTrade(m, p, ts);
  };
  const streams = [binanceTrades(onTrade, log), gateTrades(onTrade, log)];

  const timers = [
    every(10_000, () => metrics.run("sync", () => keeper.sync())),
    every(30_000, async () => {
      await metrics.run("challenge", () => keeper.challenges());
      await metrics.run("finalizer", () => keeper.finalizer());
      await metrics.run("settler", () => keeper.settler());
    }),
    every(60_000, () => metrics.run("expiry", () => keeper.expiry())),
    every(10 * 60_000, async () => {
      await metrics.run("unrevealed", () => keeper.unrevealed());
      await metrics.run("refund", () => keeper.refunds());
    }),
    every(15_000, () => metrics.run("push", () => oracle.tick?.(Math.floor(Date.now() / 1000)) ?? Promise.resolve())),
    every(60_000, async () => {
      metrics.balanceWei = await pub.getBalance({ address: account.address }).catch(() => metrics.balanceWei);
      history.prune(Math.floor(Date.now() / 1000));
    }),
  ];

  const server = createServer((req, res) => {
    if (req.url !== "/health") return void res.writeHead(404).end();
    const lowBalance = metrics.balanceWei != null && metrics.balanceWei < minBalance;
    // red if the keeper hasn't managed to load its signals for 2 minutes (API down)
    const lastSync = metrics.loops.sync.lastOk ? Date.parse(metrics.loops.sync.lastOk) : startedAt;
    const syncStale = Date.now() - lastSync > 120_000;
    const ok = !lowBalance && !tx.circuitOpen && !syncStale;
    if (lowBalance) log("error", "keeper balance low", { balance: formatEther(metrics.balanceWei!) });
    res.writeHead(ok ? 200 : 503, { "content-type": "application/json" }).end(
      JSON.stringify({
        ok,
        keeper: account.address,
        balanceHsk: metrics.balanceWei == null ? null : formatEther(metrics.balanceWei),
        minBalanceHsk: e.KEEPER_MIN_BALANCE_HSK,
        syncStale,
        rpc: { ok: tx.rpcDownSince == null, downSince: tx.rpcDownSince && new Date(tx.rpcDownSince).toISOString(), circuitOpen: tx.circuitOpen },
        touchProofsEnabled: keeper.touchProofsEnabled,
        oracle: oracle.kind,
        signals: keeper.signals.size,
        loops: metrics.loops,
        actions: metrics.actions,
        txSent: tx.sent,
      }),
    );
  });
  // internal only, like the indexer's GraphQL
  server.listen(e.KEEPER_PORT, "127.0.0.1", () => log("info", "health on /health", { port: e.KEEPER_PORT }));

  const shutdown = () => {
    for (const t of timers) clearInterval(t);
    for (const s of streams) s.close();
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  log("error", "keeper crashed", { error: (err as Error).message });
  process.exit(1);
});
