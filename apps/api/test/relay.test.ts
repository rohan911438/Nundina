/** Commit relay end to end against a fresh anvil deploy (skips without Foundry or local keys). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { contractAddress, hashSignal, toPrice } from "@nundina/shared";
import { signalBookAbi } from "@nundina/shared/abis";
import { closeDb, db } from "../src/db/client.js";
import { relayedTxs, signalDrafts, signals } from "../src/db/schema.js";
import { stopQueue } from "../src/jobs/queue.js";
import { decryptSignal, revealMaterial } from "../src/keys/keyService.js";
import { revealSignal } from "../src/jobs/reveal.js";
import { canRunChain, startChain, type Chain } from "./chain.js";
import { getJson, INTERNAL, makeProvider, postJson } from "./helpers.js";

describe.skipIf(!canRunChain)("commit relay (anvil)", () => {
  const provider = privateKeyToAccount(generatePrivateKey());
  let chain: Chain;

  beforeAll(async () => {
    chain = await startChain();
    await chain.registerProvider(provider, { practice: true });
  });

  afterAll(async () => {
    await stopQueue();
    await closeDb();
    chain?.stop();
  });

  it("prepare → sign → confirm commits on-chain, stores ciphertext, is idempotent", async () => {
    const { userId } = await makeProvider({ address: provider.address, practice: true });
    const asUser = { ...INTERNAL, "x-act-as-user": String(userId) };
    const { signalId, draftId, signal, prep, providerSig } = await chain.commitViaApi(provider, userId, 0n);

    // a second confirm (even with a different body) returns the committed signal, relays nothing
    const again = await postJson(
      `/drafts/${draftId}/confirm`,
      { signal: { ...signal, takeProfit: toPrice("84000").toString() }, commitAuth: prep.typedData.message, providerSig },
      asUser,
    );
    expect(again.status).toBe(200);
    expect(again.body.signalId).toBe(signalId.toString());

    const onchain = (await chain.pub.readContract({
      address: contractAddress(31337, "SignalBook"),
      abi: signalBookAbi,
      functionName: "getSignal",
      args: [signalId],
    })) as { commitHash: Hex };
    expect(onchain.commitHash).toBe(prep.commitHash);

    const row = await db().query.signals.findFirst({ where: eq(signals.id, signalId) });
    expect(row?.status).toBe("COMMITTED");
    expect(row?.entry).toBeNull(); // plaintext not stored in clear
    const body = decryptSignal({ ciphertext: row!.ciphertext!, aesKeyEnc: row!.aesKeyEnc! });
    expect(body.entry).toBe(signal.entry);
    expect("salt" in body).toBe(false);

    const txs = await db().select().from(relayedTxs).where(eq(relayedTxs.idempotencyKey, `commit:draft:${draftId}`));
    expect(txs).toHaveLength(1);
    const draft = await db().query.signalDrafts.findFirst({ where: eq(signalDrafts.id, draftId) });
    expect(draft?.status).toBe("committed");
    expect((await getJson(`/signals/${signalId}`)).body.entry).toBeNull();

    // the reveal job publishes on-chain and mirrors the plaintext; a second run sends nothing
    const mat = await revealMaterial(signalId);
    expect(hashSignal(mat, 31337, contractAddress(31337, "SignalBook"))).toBe(prep.commitHash);
    const r = await revealSignal(signalId);
    expect(r.tx).toBeDefined();
    const revealed = await chain.pub.readContract({
      address: contractAddress(31337, "SignalBook"),
      abi: signalBookAbi,
      functionName: "isRevealed",
      args: [signalId],
    });
    expect(revealed).toBe(true);
    expect((await revealSignal(signalId)).tx).toBeUndefined();
    const pubView = await getJson(`/signals/${signalId}`);
    expect(pubView.body.revealed).toBe(true);
    expect(pubView.body.entry).toBe("81500.00");

    const health = await getJson("/health");
    expect(health.body.rpc.ok).toBe(true);
    expect(health.body.relayer.canSend).toBe(true);
  });

  it("rejects a tampered signal on first confirm", async () => {
    const { userId } = await makeProvider({ address: privateKeyToAccount(generatePrivateKey()).address });
    const asUser = { ...INTERNAL, "x-act-as-user": String(userId) };
    const d = await postJson("/drafts", { rawText: "x" }, asUser);
    const block = await chain.pub.getBlock();
    const signal = {
      market: "BTC/USD",
      side: "LONG",
      entry: toPrice("81500").toString(),
      takeProfit: toPrice("83000").toString(),
      stopLoss: toPrice("80800").toString(),
      validUntil: String(Math.max(Number(block.timestamp), Math.floor(Date.now() / 1000)) + 3600),
      pricePerSub: "0",
    };
    const prep = await postJson(`/drafts/${d.body.id}/prepare`, signal, asUser);
    expect(prep.status).toBe(200);
    const r = await postJson(
      `/drafts/${d.body.id}/confirm`,
      { signal: { ...signal, takeProfit: toPrice("84000").toString() }, commitAuth: prep.body.typedData.message, providerSig: "0x1234" },
      asUser,
    );
    expect(r.status).toBe(400);
  });

  it("another user cannot touch someone else's draft", async () => {
    const owner = await makeProvider({ address: privateKeyToAccount(generatePrivateKey()).address });
    const stranger = await makeProvider({ address: privateKeyToAccount(generatePrivateKey()).address });
    const d = await postJson("/drafts", { rawText: "x" }, { ...INTERNAL, "x-act-as-user": String(owner.userId) });
    const r = await postJson(`/drafts/${d.body.id}/prepare`, {}, { ...INTERNAL, "x-act-as-user": String(stranger.userId) });
    expect(r.status).toBe(403);
  });
});
