/**
 * Keeper end to end on anvil (MockPriceAdapter): trade → proveTouch → restart → finalize → settle,
 * challenges, expiry, a touch missed during an outage, the unrevealed sweep and the refund sweep.
 * Skips without Foundry or local keys.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWalletClient, http, parseEther, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { contractAddress, localChain, MARKETS, toPrice } from "@nundina/shared";
import { mockPriceAdapterAbi, performanceEscrowAbi, providerRegistryAbi } from "@nundina/shared/abis";
import { closeDb } from "../../api/src/db/client.js";
import { stopQueue } from "../../api/src/jobs/queue.js";
import { processVerify } from "../../api/src/jobs/hspRetry.js";
import { revealSignal } from "../../api/src/jobs/reveal.js";
import { buyAndPay, newBuyer } from "../../api/test/buyer.js";
import { canRunChain, keys, startChain, type Chain } from "../../api/test/chain.js";
import { app, makeProvider } from "../../api/test/helpers.js";
import { addresses, chainNow, readSignal } from "../src/chain.js";
import { SL, TP } from "../src/detectors/touch.js";
import { PriceHistory } from "../src/history.js";
import { Keeper } from "../src/keeper.js";
import { Metrics } from "../src/metrics.js";
import { MockOracle } from "../src/oracle/mock.js";
import type { Oracle } from "../src/oracle/types.js";
import { KeeperApi, type Candidate } from "../src/state.js";
import { TxSender } from "../src/tx.js";

const PRICE = 1_000_000n; // 1 USDT
const BTC = MARKETS["BTC/USD"].id;
const a = addresses(31337);

describe.skipIf(!canRunChain)("keeper on anvil", () => {
  const provider = privateKeyToAccount(generatePrivateKey());
  const keeperAccount = privateKeyToAccount((keys.KEEPER_PRIVATE_KEY ?? "0x") as Hex);
  let chain: Chain;
  let userId: number;
  let payout: Hex;

  const api = new KeeperApi("http://api.test", "test-internal-secret-0123456789", (u, i) => Promise.resolve(app.request(u, i)));
  const log = () => {};

  /** A fresh keeper process (empty memory), as after a restart. */
  function newKeeper(opts: { api?: KeeperApi; oracle?: (o: MockOracle) => Oracle; history?: PriceHistory } = {}) {
    const wallet = createWalletClient({ account: keeperAccount, chain: localChain, transport: http(chain.rpc) });
    const tx = new TxSender(chain.pub as any, wallet, 1000, log);
    const history = opts.history ?? new PriceHistory();
    const mock = new MockOracle(chain.pub as any, tx, a.pushAdapter, history, 60);
    const oracle = opts.oracle ? opts.oracle(mock) : mock;
    return new Keeper(chain.pub as any, a, opts.api ?? api, tx, oracle, history, new Metrics(), log, { proofRetryMs: 0 });
  }

  const now = () => chainNow(chain.pub as any);
  async function warpTo(ts: number) {
    await chain.testClient.setNextBlockTimestamp({ timestamp: BigInt(ts) });
    await chain.testClient.mine({ blocks: 1 });
  }
  const warp = async (s: number) => warpTo((await now()) + s);
  const state = (id: bigint) => readSignal(chain.pub as any, a, id);

  /** Keeps the push feed fresh so commits don't revert StalePrice after time warps. */
  async function pushNow(price = "81500") {
    const w = createWalletClient({ account: keeperAccount, chain: localChain, transport: http(chain.rpc) });
    await chain.pub.waitForTransactionReceipt({
      hash: await w.writeContract({ address: a.pushAdapter, abi: mockPriceAdapterAbi, functionName: "push", args: [BTC, toPrice(price), BigInt(await now())] }),
    });
  }

  async function commit(levels?: Parameters<Chain["commitViaApi"]>[3]) {
    await pushNow();
    const { signalId } = await chain.commitViaApi(provider, userId, PRICE, levels);
    return signalId;
  }

  async function buy(signalId: bigint) {
    const b = await newBuyer(chain);
    const { purchaseId } = await buyAndPay(chain, b, signalId, PRICE);
    expect((await processVerify(purchaseId)).status).toBe("KEY_SENT");
    return b.account.address;
  }

  const claimable = (who: Hex) =>
    chain.pub.readContract({ address: a.escrow, abi: performanceEscrowAbi, functionName: "claimable", args: [who, chain.usdt] });

  beforeAll(async () => {
    chain = await startChain();
    await chain.testClient.setBalance({ address: keeperAccount.address, value: parseEther("100") });
    await chain.registerProvider(provider, { bondUsd: "10" });
    ({ userId } = await makeProvider({ address: provider.address }));
    payout = (await chain.pub.readContract({
      address: contractAddress(31337, "ProviderRegistry"),
      abi: providerRegistryAbi,
      functionName: "payoutOf",
      args: [provider.address],
    })) as Hex;
  });

  afterAll(async () => {
    await stopQueue();
    await closeDb();
    chain?.stop();
  });

  it("trade crosses TP → proveTouch; a restarted keeper finalizes after the window and settles (provider paid)", async () => {
    const id = await commit();
    await buy(id);
    const k1 = newKeeper();
    await k1.sync();
    expect(k1.touchProofsEnabled).toBe(true);

    k1.onTrade("BTC/USD", toPrice("83050"), await now());
    await expect.poll(async () => (await state(id)).resolver.pendingTs, { timeout: 20_000 }).toBeGreaterThan(0);
    expect((await state(id)).resolver.pendingLevel).toBe(TP);

    // restart in the middle of the challenge window: nothing to finalize yet
    const k2 = newKeeper();
    await k2.runAll();
    expect((await state(id)).resolver.final).toBe(false);

    await warp(601);
    const before = await claimable(payout);
    await k2.runAll();
    const s = await state(id);
    expect(s).toMatchObject({ outcome: "WIN", outcomeFinal: true, pot: "SETTLED" });
    expect((await claimable(payout)) - before).toBe((PRICE * 9n) / 10n); // 10% fee
    expect(k2.metrics.actions).toMatchObject({ finalize: 1, settle: 1 });
  }, 120_000);

  it("an earlier SL in the price history wins the challenge; buyer refunded plus slash", async () => {
    const id = await commit({ side: "SHORT", entry: "81500", takeProfit: "80000", stopLoss: "82200" });
    const buyer = await buy(id);
    const history = new PriceHistory();
    const k = newKeeper({ history });
    await k.sync();
    const t = await now();
    history.add("BTC/USD", toPrice("82300"), t + 1); // SL touched first (seen, not yet proven)
    await k.prove(k.signals.get(id.toString())!, TP, { price: toPrice("79900"), ts: t + 3 }); // someone proves the later TP
    expect((await state(id)).resolver.pendingLevel).toBe(TP);

    await k.challenges();
    const st = await state(id);
    expect(st.resolver.pendingLevel).toBe(SL);
    expect(st.resolver.pendingTs).toBe(t + 1);

    await warp(601);
    await k.runAll();
    expect(await state(id)).toMatchObject({ outcome: "LOSS", pot: "SETTLED" });
    expect(await claimable(buyer)).toBeGreaterThan(PRICE); // refund + share of the slashed bond
  }, 120_000);

  it("an untouched signal resolves at expiry from the pushed rounds", async () => {
    const id = await commit();
    const history = new PriceHistory();
    const k = newKeeper({ history });
    await k.sync();
    const vu = (await state(id)).validUntil;
    history.add("BTC/USD", toPrice("81550"), vu - 30); // last price before expiry, pushed as a round
    await k.runAll();

    await warpTo(vu + 5);
    await k.runAll();
    expect((await state(id)).resolver.pendingLevel).toBe(3); // expiry mark, open to challenges
    await warp(601);
    await k.runAll();
    expect(await state(id)).toMatchObject({ outcome: "LOSS", outcomeFinal: true, pot: "SETTLED" }); // +50 < 0.5R
  }, 120_000);

  it("a touch during a keeper outage is found in backfilled candles and proven instead of the expiry mark", async () => {
    const id = await commit();
    const history = new PriceHistory();
    const k = newKeeper({ history });
    await k.sync();
    const s0 = await state(id);
    history.addRange("BTC/USD", toPrice("81400"), toPrice("83200"), s0.committedAt + 60); // 1-min candle through TP
    await warpTo(s0.validUntil + 30 * 60); // keeper was down 30 min past expiry
    await k.runAll();
    const st = await state(id);
    expect(st.resolver.pendingLevel).toBe(TP);
    expect(st.resolver.pendingTs).toBe(s0.committedAt + 60);
    await warp(601);
    await k.runAll();
    expect(await state(id)).toMatchObject({ outcome: "WIN", pot: "SETTLED" });
  }, 120_000);

  it("unrevealed sweep: no plaintext anywhere → markUnrevealed → settled as a loss", async () => {
    const id = await commit();
    const blind = new KeeperApi("http://api.test", "x");
    blind.candidates = async () => (await api.candidates()).map((c: Candidate) => ({ ...c, hasMaterial: false }));
    blind.material = async () => null;
    const k = newKeeper({ api: blind });
    await k.sync();
    await warpTo((await state(id)).validUntil + 6 * 3600 + 5);
    await k.runAll();
    expect(await state(id)).toMatchObject({ status: "UNREVEALED_LOSS", outcome: "LOSS", pot: "SETTLED" });
  }, 120_000);

  it("refund sweep: no price for the expiry → after 24 h everyone is refunded", async () => {
    const id = await commit();
    const buyer = await buy(id);
    await revealSignal(id); // revealed, so the unrevealed sweep doesn't apply
    const k = newKeeper({ oracle: (m) => ({ kind: "mock", canProveHistory: false, touchProof: m.touchProof.bind(m), expiryArgs: async () => [] }) });
    await k.sync();
    const before = await claimable(buyer);
    await warpTo((await state(id)).validUntil + 24 * 3600 + 5);
    await k.runAll();
    expect((await state(id)).pot).toBe("REFUNDED");
    expect((await claimable(buyer)) - before).toBe(PRICE);
  }, 120_000);
});

