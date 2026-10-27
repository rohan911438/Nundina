/**
 * MCP server end to end: the real MCP client over Streamable HTTP → this server → the API
 * (in-process, mock HSP) → anvil. Two signals are settled on-chain by the keeper (one TP win, one
 * SL loss) and projected into the DB as the indexer would; a third is bought through buy_signal.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createWalletClient, getAddress, http, parseEther, type Hex } from "viem";
import { eq } from "drizzle-orm";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ENCRYPTION_KEY_MESSAGE, MARKETS, decryptSignalBody, deriveEncryptionKey, localChain, toPrice, unwrapKey } from "@nundina/shared";
import { mockPriceAdapterAbi } from "@nundina/shared/abis";
import { closeDb, db } from "../../api/src/db/client.js";
import { signals, users } from "../../api/src/db/schema.js";
import { stopQueue } from "../../api/src/jobs/queue.js";
import { processVerify } from "../../api/src/jobs/hspRetry.js";
import { recomputeProvider } from "../../api/src/jobs/scoring.js";
import { setPriceFetcher } from "../../api/src/services/prices.js";
import { canRunChain, keys, startChain, type Chain } from "../../api/test/chain.js";
import { INTERNAL, app, makeProvider, postJson } from "../../api/test/helpers.js";
import { addresses, chainNow, readSignal } from "../../keeper/src/chain.js";
import { Keeper } from "../../keeper/src/keeper.js";
import { Metrics } from "../../keeper/src/metrics.js";
import { MockOracle } from "../../keeper/src/oracle/mock.js";
import { PriceHistory } from "../../keeper/src/history.js";
import { KeeperApi } from "../../keeper/src/state.js";
import { TxSender } from "../../keeper/src/tx.js";
import { resetEnv } from "../src/env.js";
import { resetChain } from "../src/chain.js";
import { createHttpApp } from "../src/http.js";
import { setApiFetch } from "../src/nundina.js";
import { setFacilitatorFetch } from "../src/paywall.js";
import { registerIdentity } from "../src/identity.js";
import { identityRegistryAbi } from "@nundina/shared/abis";

const PRICE = 300_000n;
const BTC = MARKETS["BTC/USD"].id;
const mcp = createHttpApp();

async function connect(apiKey?: string) {
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("http://mcp.test/mcp"), {
    fetch: async (u, i) => mcp.request(String(u), i as RequestInit),
    requestInit: apiKey ? { headers: { authorization: `Bearer ${apiKey}` } } : undefined,
  });
  await client.connect(transport);
  return client;
}
const data = (r: any) => r.structuredContent as any;

/** Deterministic BTC 1h candles for the scoring alpha. */
setPriceFetcher((async (url: string) => {
  const u = new URL(url);
  const start = Number(u.searchParams.get("startTime"));
  const end = Number(u.searchParams.get("endTime"));
  const rows = [];
  for (let t = Math.floor(start / 3_600_000) * 3_600_000; t <= end; t += 3_600_000) rows.push([t, "81000", "81500", "80500", String(81_000 + (t / 3_600_000) % 100), "10"]);
  return new Response(JSON.stringify(rows));
}) as typeof fetch);

describe.skipIf(!canRunChain)("mcp server", () => {
  let chain: Chain;
  const provider = privateKeyToAccount(generatePrivateKey());
  let handle: string;
  let liveId: bigint;
  let decided: bigint[] = [];

  beforeAll(async () => {
    chain = await startChain();
    resetEnv();
    resetChain();
    setApiFetch((u, i) => Promise.resolve(app.request(u, i)));
    const a = addresses(31337);
    const keeperAccount = privateKeyToAccount(keys.KEEPER_PRIVATE_KEY as Hex);
    await chain.testClient.setBalance({ address: keeperAccount.address, value: parseEther("100") });
    const kw = createWalletClient({ account: keeperAccount, chain: localChain, transport: http(chain.rpc) });
    const now = () => chainNow(chain.pub as any);
    const push = async (p: string) =>
      chain.pub.waitForTransactionReceipt({ hash: await kw.writeContract({ address: a.pushAdapter, abi: mockPriceAdapterAbi, functionName: "push", args: [BTC, toPrice(p), BigInt(await now())] }) });

    await chain.registerProvider(provider, { bondUsd: "20" });
    const p = await makeProvider({ address: provider.address, handle: `mcp_${Date.now() % 1_000_000}` });
    handle = p.handle;
    await push("81500");
    const win = (await chain.commitViaApi(provider, p.userId, PRICE)).signalId;
    const loss = (await chain.commitViaApi(provider, p.userId, PRICE, { side: "SHORT", entry: "81500", takeProfit: "80000", stopLoss: "82200" })).signalId;
    decided = [win, loss];

    // keeper: price runs to 84200 → long TP, short SL; finalize + settle after the window
    const tx = new TxSender(chain.pub as any, kw as any, 1000, () => {});
    const history = new PriceHistory();
    const keeper = new Keeper(chain.pub as any, a, new KeeperApi("http://api.test", "test-internal-secret-0123456789", (u, i) => Promise.resolve(app.request(u, i))), tx, new MockOracle(chain.pub as any, tx, a.pushAdapter, history, 60), history, new Metrics(), () => {}, { proofRetryMs: 0 });
    await keeper.sync();
    for (let i = 0; i < 40; i++) {
      await chain.testClient.mine({ blocks: 1 });
      keeper.onTrade("BTC/USD", toPrice("84200"), await now());
      const st = await Promise.all(decided.map((id) => readSignal(chain.pub as any, a, id)));
      if (st.every((s) => s.resolver.pendingTs > 0)) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    await chain.testClient.setNextBlockTimestamp({ timestamp: BigInt((await now()) + 601) });
    await chain.testClient.mine({ blocks: 1 });
    await keeper.runAll();
    // project the outcomes into the DB the way the indexer does
    for (const [id, outcome, r] of [[win, "WIN", "2.14"], [loss, "LOSS", "-1.00"]] as const) {
      const s = await readSignal(chain.pub as any, a, id);
      expect(s.outcome).toBe(outcome);
      const lv = outcome === "WIN" ? { side: 0, entry: toPrice("81500"), tp: toPrice("83000"), sl: toPrice("80800") } : { side: 1, entry: toPrice("81500"), tp: toPrice("80000"), sl: toPrice("82200") };
      await db()
        .update(signals)
        .set({ status: "SETTLED", outcome, rMultiple: r, decidedAt: new Date(), revealedAt: new Date(), side: lv.side, entry: lv.entry.toString(), tp: lv.tp.toString(), sl: lv.sl.toString() })
        .where(eq(signals.id, id));
    }
    await recomputeProvider(p.providerId, { fetchPrices: true });

    await push("81500");
    liveId = (await chain.commitViaApi(provider, p.userId, PRICE)).signalId;
  });

  afterAll(async () => {
    await stopQueue();
    await closeDb();
    chain?.stop();
  });

  it("serves the agent card and lists six tools that state their cost and the advice disclaimer", async () => {
    const card = (await (await mcp.request("http://mcp.test/.well-known/agent.json")).json()) as any;
    expect(card.url).toBe("http://mcp.test/mcp");
    expect(card.skills.map((s: any) => s.id)).toEqual(["list_providers", "get_signals", "get_signal", "verify_track_record", "buy_signal", "get_purchase"]);
    const c = await connect();
    const { tools } = await c.listTools();
    expect(tools).toHaveLength(6);
    const by = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(by.verify_track_record!.description).toMatch(/PAID: 0\.01 USDC\.e/);
    expect(by.buy_signal!.description).toMatch(/SPENDS MONEY/);
    for (const t of ["list_providers", "get_signals", "verify_track_record", "buy_signal"]) expect(by[t]!.description).toMatch(/not investment advice/);
    expect(by.list_providers!.inputSchema.properties).toHaveProperty("minScore");
    expect(by.get_signal!.outputSchema).toBeDefined();
  });

  it("validates inputs against the schemas", async () => {
    const c = await connect();
    const bad = await c.callTool({ name: "list_providers", arguments: { limit: 0 } });
    expect(bad.isError).toBe(true);
    const bad2 = await c.callTool({ name: "get_signal", arguments: { id: "abc" } });
    expect(bad2.isError).toBe(true);
  });

  it("free tools: providers, live signals sealed, signal detail with proofs", async () => {
    const c = await connect();
    const lp = data(await c.callTool({ name: "list_providers", arguments: { period: "all", limit: 100 } }));
    expect(lp.providers.some((p: any) => p.handle === handle)).toBe(true);
    const live = data(await c.callTool({ name: "get_signals", arguments: { status: "live", provider: handle } }));
    const mine = live.signals.find((s: any) => s.id === liveId.toString());
    expect(mine).toMatchObject({ side: null, entry: null, priceUsd: "0.3" });
    const settled = data(await c.callTool({ name: "get_signals", arguments: { status: "settled", provider: handle } }));
    expect(settled.signals.map((s: any) => s.outcome).sort()).toEqual(["LOSS", "WIN"]);
    const one = data(await c.callTool({ name: "get_signal", arguments: { id: decided[0]!.toString() } }));
    expect(one.commitHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(one.proofs.commitTx).toMatch(/^0x/);
    expect(one.explorer.commitTx).toContain(one.proofs.commitTx);
  });

  it("verify_track_record: payment required, then paid by credits; recomputed from chain equals the API score", async () => {
    const anon = await connect();
    const r1 = await anon.callTool({ name: "verify_track_record", arguments: { handle } });
    expect(r1.isError).toBe(true);
    expect(data(r1)).toMatchObject({ error: "payment_required", x402Version: 1 });
    expect(data(r1).accepts[0]).toMatchObject({ scheme: "exact", maxAmountRequired: "10000" });

    const { apiKey, agentId } = await newAgentKey();
    const keyed = await connect(apiKey);
    const r2 = await keyed.callTool({ name: "verify_track_record", arguments: { handle } });
    expect(data(r2).error).toBe("payment_required"); // no credit yet
    await postJson(`/internal/agents/${agentId}/credits`, { amount: "15000" }, INTERNAL);
    const r3 = data(await keyed.callTool({ name: "verify_track_record", arguments: { handle } }));
    expect(r3.paid).toMatchObject({ via: "credits", remainingUsd: "0.005" });
    expect(r3.mismatches).toEqual([]);
    expect(r3.matches).toBe(true);
    expect(r3.recomputed.all).toMatchObject({ n: 2, wins: 1, losses: 1, probation: true });
    expect(r3.reported.all).toMatchObject({ n: 2, wins: 1 });
    expect(r3.recomputed.all.wilsonLb).toBeCloseTo(r3.reported.all.wilsonLb, 3);
    expect(r3.signals).toHaveLength(2);
    expect(r3.signals[0].tx.commit).toMatch(/^0x/);
    const r4 = await keyed.callTool({ name: "verify_track_record", arguments: { handle } });
    expect(data(r4).error).toBe("payment_required"); // 0.005 left < 0.01

    // a DB that disagrees with the chain is caught
    await db().update(signals).set({ outcome: "WIN" }).where(eq(signals.id, decided[1]!));
    await postJson(`/internal/agents/${agentId}/credits`, { amount: "10000" }, INTERNAL);
    const r5 = data(await keyed.callTool({ name: "verify_track_record", arguments: { handle } }));
    expect(r5.matches).toBe(false);
    expect(r5.mismatches.join(" ")).toMatch(/API says WIN, chain says LOSS/);
    await db().update(signals).set({ outcome: "LOSS" }).where(eq(signals.id, decided[1]!));
  });

  it("verify_track_record: x402 payment through a (mocked) facilitator", async () => {
    const payTo = "0x00000000000000000000000000000000000000Aa";
    Object.assign(process.env, { HSP_FACILITATOR_URL: "http://facilitator.test", MCP_PAY_TO: payTo });
    resetEnv();
    const calls: string[] = [];
    setFacilitatorFetch(async (url, init) => {
      calls.push(url);
      const body = JSON.parse(String(init.body));
      expect(body.paymentRequirements.payTo).toBe(getAddress(payTo));
      return new Response(JSON.stringify(url.endsWith("/verify") ? { isValid: true, payer: "0xabc" } : { success: true, transaction: "0x" + "ab".repeat(32), payer: "0xabc" }));
    });
    try {
      const c = await connect();
      const pay = (value: string, to = payTo) =>
        Buffer.from(JSON.stringify({ x402Version: 1, scheme: "exact", network: "eip155:31337", payload: { signature: "0x" + "11".repeat(65), authorization: { from: "0xabc", to, value, validAfter: "0", validBefore: "9999999999", nonce: "0x" + "22".repeat(32) } } })).toString("base64");
      const low = await c.callTool({ name: "verify_track_record", arguments: { handle, payment: pay("9999") } });
      expect(data(low).error).toBe("payment_invalid");
      const wrongTo = await c.callTool({ name: "verify_track_record", arguments: { handle, payment: pay("10000", "0x00000000000000000000000000000000000000Bb") } });
      expect(data(wrongTo).error).toBe("payment_invalid");
      const r = data(await c.callTool({ name: "verify_track_record", arguments: { handle, payment: pay("10000") } }));
      expect(r.paid).toMatchObject({ via: "x402", tx: "0x" + "ab".repeat(32) });
      expect(calls).toEqual(["http://facilitator.test/verify", "http://facilitator.test/settle"]);
    } finally {
      delete process.env.HSP_FACILITATOR_URL;
      delete process.env.MCP_PAY_TO;
      resetEnv();
    }
  });

  it("buy_signal (delegated): refuses over maxPrice, returns a mandate, unlocks after payment; get_purchase tracks it", async () => {
    const { apiKey, buyer } = await newAgentKey("2");
    const c = await connect(apiKey);
    expect((await c.callTool({ name: "buy_signal", arguments: { id: liveId.toString(), maxPrice: "0.2" } })).isError).toBe(true);
    expect((await connect()).callTool({ name: "buy_signal", arguments: { id: liveId.toString(), maxPrice: "1" } })).resolves.toMatchObject({ isError: true });

    const enc = deriveEncryptionKey(await buyer.signMessage({ message: ENCRYPTION_KEY_MESSAGE }));
    const s1 = data(await c.callTool({ name: "buy_signal", arguments: { id: liveId.toString(), maxPrice: "0.5", encryptionPublicKey: enc.publicKey } }));
    expect(s1).toMatchObject({ mode: "delegated", step: "pay", status: "PENDING", priceUsd: "0.3" });
    const td = s1.mandate;
    const mandateSig = await buyer.signTypedData({
      domain: { ...td.domain, chainId: Number(td.domain.chainId) },
      types: td.types,
      primaryType: "Mandate",
      message: { ...td.message, amount: BigInt(td.message.amount), chainId: BigInt(td.message.chainId), deadline: BigInt(td.message.deadline) },
    });
    const txHash = await chain.transfer(buyer, getAddress(td.message.token), getAddress(s1.payee), BigInt(td.message.amount));

    const pending = c.callTool({ name: "buy_signal", arguments: { id: liveId.toString(), maxPrice: "0.5", purchaseId: s1.purchaseId, mandateSig, txHash } });
    // no workers in tests: run the HSP verify job once the submit lands
    for (let i = 0; i < 40; i++) {
      const st = await c.callTool({ name: "get_purchase", arguments: { purchaseId: s1.purchaseId } });
      if (data(st).status === "SUBMITTED") {
        await processVerify(s1.purchaseId);
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    const s2 = data(await pending);
    expect(s2).toMatchObject({ step: "unlocked", status: "KEY_SENT" });
    const body = decryptSignalBody<any>(unwrapKey(enc.privateKey, s2.delivery.wrappedKey), s2.delivery.ciphertext, s2.delivery.iv);
    expect(body.side).toBe(0);
    expect(BigInt(body.takeProfit)).toBe(toPrice("83000"));

    const gp = data(await c.callTool({ name: "get_purchase", arguments: { purchaseId: s1.purchaseId } }));
    expect(gp).toMatchObject({ status: "KEY_SENT", keyReady: true, amountUsd: "0.3" });
    expect(gp).not.toHaveProperty("plaintext");
  });

  it("registers the server's ERC-8004 identity pointing at its agent card", async () => {
    const pk = generatePrivateKey();
    const owner = privateKeyToAccount(pk);
    await chain.fund(owner);
    const r = await registerIdentity(pk);
    expect(r.agentUri).toBe("http://mcp.test/.well-known/agent.json");
    const uri = await chain.pub.readContract({ address: r.registry, abi: identityRegistryAbi, functionName: "tokenURI", args: [r.agentId] });
    expect(uri).toBe(r.agentUri);
    const holder = await chain.pub.readContract({ address: r.registry, abi: identityRegistryAbi, functionName: "ownerOf", args: [r.agentId] });
    expect(holder).toBe(owner.address);
  });

  it("buy_signal without a key is refused unless custodial demo mode is on", async () => {
    const c = await connect();
    const r = data(await c.callTool({ name: "buy_signal", arguments: { id: liveId.toString(), maxPrice: "1" } }));
    expect(r.error).toBe("auth_required");
  });

  /** A user with a funded wallet and an MCP agent key (pays from that wallet). */
  async function newAgentKey(usd = "0") {
    const buyer = privateKeyToAccount(generatePrivateKey());
    await chain.fund(buyer, usd);
    const [u] = await db().insert(users).values({ wallet: buyer.address.toLowerCase() }).returning();
    const r = await postJson("/me/api-keys", { name: "test agent" }, { ...INTERNAL, "x-act-as-user": String(u!.id) });
    expect(r.status).toBe(201);
    expect(r.body.agent.wallet).toBe(buyer.address.toLowerCase());
    return { apiKey: r.body.apiKey as string, agentId: r.body.agent.id as number, buyer };
  }
});

