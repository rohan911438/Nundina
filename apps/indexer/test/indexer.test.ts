/**
 * Ponder + projector end to end on anvil: commit → buy → never revealed → settle (LOSS, refunds).
 * Checks the API tables fill from chain events alone, the score job is queued, and `reproject`
 * rebuilds the same state. Skips without Foundry or local keys.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, openSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { encodeFunctionData } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { contractAddress } from "@nundina/shared";
import { performanceEscrowAbi, signalBookAbi } from "@nundina/shared/abis";
import { closeDb, db, sql } from "../../api/src/db/client.js";
import { providers, purchases, settlements, signals } from "../../api/src/db/schema.js";
import { recomputeProvider } from "../../api/src/jobs/scoring.js";
import { enqueue, JOBS, stopQueue } from "../../api/src/jobs/queue.js";
import { processVerify } from "../../api/src/jobs/hspRetry.js";
import { buyAndPay, newBuyer } from "../../api/test/buyer.js";
import { canRunChain, keys, startChain, type Chain } from "../../api/test/chain.js";
import { getJson, makeProvider } from "../../api/test/helpers.js";
import { resetProjections, syncOnce } from "../src/sync.js";

const PRICE = 1_000_000n;
const SCHEMA = "idx_test";
const PONDER_LOG = join(tmpdir(), "nundina-ponder-test.log");
const ponderLogTail = () => (existsSync(PONDER_LOG) ? readFileSync(PONDER_LOG, "utf8").split(/\r?\n/).slice(-40).join("\n") : "(no log)");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

async function until<T>(fn: () => Promise<T | undefined | null | false>, ms = 60_000): Promise<T> {
  const end = Date.now() + ms;
  let last: unknown;
  for (;;) {
    const v = await fn().catch((e) => void (last = e));
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out${last ? `: ${(last as Error).message}` : ""}\n--- ponder log (tail)\n${ponderLogTail()}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** Projected state that must survive a reproject unchanged. */
async function snapshot(signalId: bigint) {
  const s = await db().query.signals.findFirst({ where: eq(signals.id, signalId) });
  const ps = await db().select({ status: purchases.status, creditedTx: purchases.creditedTx }).from(purchases).where(eq(purchases.signalId, signalId));
  const st = await db().query.settlements.findFirst({ where: eq(settlements.signalId, signalId) });
  return {
    status: s?.status,
    outcome: s?.outcome,
    r: s?.rMultiple,
    commitTx: s?.commitTx,
    purchaseCount: s?.purchaseCount,
    purchases: ps.map((p) => p.status).sort(),
    settlement: st && { outcome: st.outcome, refunds: st.refundsTotal, payout: st.payout, tx: st.settleTx },
  };
}

describe.skipIf(!canRunChain)("indexer (ponder + projector on anvil)", () => {
  const provider = privateKeyToAccount(generatePrivateKey());
  let chain: Chain;
  let ponder: ChildProcess;
  let signalId: bigint;

  beforeAll(async () => {
    chain = await startChain();
    process.env.INDEXER_DB_SCHEMA = SCHEMA;
    await sql().unsafe(`drop schema if exists ${SCHEMA} cascade`);
    const log = openSync(PONDER_LOG, "w");
    ponder = spawn("pnpm", ["exec", "ponder", "start", "--schema", SCHEMA, "--port", String(43_000 + Math.floor(Math.random() * 1000))], {
      cwd: root,
      shell: process.platform === "win32",
      stdio: ["ignore", log, log],
      env: { ...process.env, INDEXER_CHAIN_ID: "31337", INDEXER_START_BLOCK: "0", LOCAL_RPC_URL: chain.rpc, DATABASE_URL: process.env.DATABASE_URL },
    });
    await chain.registerProvider(provider, { bondUsd: "3" });
    const { userId } = await makeProvider({ address: provider.address });
    ({ signalId } = await chain.commitViaApi(provider, userId, PRICE));
  });

  afterAll(async () => {
    if (ponder?.pid && process.platform === "win32") spawnSync("taskkill", ["/F", "/T", "/PID", String(ponder.pid)]);
    else ponder?.kill();
    await stopQueue();
    await closeDb();
    chain?.stop();
  });

  const head = () => chain.pub.getBlockNumber();

  it("projects the commit and an off-app payment", async () => {
    const b = await newBuyer(chain);
    const { purchaseId } = await buyAndPay(chain, b, signalId, PRICE);
    expect((await processVerify(purchaseId)).status).toBe("KEY_SENT");

    // wait for Ponder to have the credit, then project
    const target = await head();
    await until(async () => {
      await syncOnce(target);
      const s = await db().query.signals.findFirst({ where: eq(signals.id, signalId) });
      return s?.commitBlock && s.purchaseCount === 1;
    });
    const s = await db().query.signals.findFirst({ where: eq(signals.id, signalId) });
    expect(s!.commitTx).toMatch(/^0x/);
    expect(s!.oraclePrice).not.toBeNull();
  }, 120_000);

  it("unrevealed → settled LOSS: refunds, status, score job", async () => {
    const r = await chain.pub.readContract({ address: contractAddress(31337, "SignalBook"), abi: signalBookAbi, functionName: "getSignal", args: [signalId] });
    await chain.testClient.setNextBlockTimestamp({ timestamp: BigInt(r.validUntil) + 6n * 3600n + 10n });
    await chain.testClient.mine({ blocks: 1 });
    const caller = chain.wallet(privateKeyToAccount(keys.RELAYER_PRIVATE_KEY as `0x${string}`));
    const calls = [
      { to: contractAddress(31337, "SignalBook"), data: encodeFunctionData({ abi: signalBookAbi, functionName: "markUnrevealed", args: [signalId] }) },
      { to: contractAddress(31337, "PerformanceEscrow"), data: encodeFunctionData({ abi: performanceEscrowAbi, functionName: "settle", args: [signalId] }) },
    ];
    for (const c of calls) await chain.pub.waitForTransactionReceipt({ hash: await caller.sendTransaction(c) });
    // a little depth past the settle so Ponder's realtime sync doesn't wait on the head block
    await chain.testClient.mine({ blocks: 3 });

    const t0 = Date.now();
    const target = await head();
    await until(async () => {
      await syncOnce(target);
      return (await db().query.settlements.findFirst({ where: eq(settlements.signalId, signalId) })) ?? false;
    });
    const snap = await snapshot(signalId);
    expect(snap.status).toBe("UNREVEALED_LOSS");
    expect(snap.outcome).toBe("LOSS");
    expect(snap.r).toBe("-1.00");
    expect(snap.purchases).toEqual(["REFUNDED"]);
    expect(snap.settlement).toMatchObject({ outcome: "LOSS", refunds: PRICE.toString(), payout: "0" });
    expect(Date.now() - t0).toBeLessThan(10_000);

    const jobs = await sql().unsafe(`select name, data from pgboss.job where name = 'score.recompute'`);
    const job = jobs.find((j: any) => j.data?.providerId);
    if (!job) {
      const all = await sql().unsafe(`select name, state, singleton_key, data from pgboss.job order by created_on`).catch((e) => [String(e)]);
      const probe = await enqueue(JOBS.score, { probe: true }).catch((e) => `threw ${e}`);
      throw new Error(`no score job; probe enqueue → ${probe}; pgboss.job: ${JSON.stringify(all)}`);
    }

    // what the API worker does with that job, then the public read
    await recomputeProvider(job!.data.providerId, { fetchPrices: false });
    const p = await db().query.providers.findFirst({ where: eq(providers.id, job!.data.providerId) });
    const res = await getJson(`/providers/${p!.handle}`);
    expect(res.body.score).toMatchObject({ n: 1, losses: 1, probation: true, score: null });
  }, 120_000);

  it("reproject rebuilds the same state", async () => {
    const before = await snapshot(signalId);
    await resetProjections();
    const reset = await snapshot(signalId);
    expect(reset.status).toBe("COMMITTED");
    expect(reset.settlement).toBeUndefined();
    await syncOnce(await head());
    expect(await snapshot(signalId)).toEqual(before);
  }, 60_000);
});
