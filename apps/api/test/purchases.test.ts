/** DirectRail purchase flow end to end on anvil (skips without Foundry or local keys). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { keccak256, encodeAbiParameters, type Hex, type PrivateKeyAccount } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  ENCRYPTION_KEY_MESSAGE,
  contractAddress,
  decryptSignalBody,
  deriveEncryptionKey,
  unwrapKey,
  usdcE,
} from "@nundina/shared";
import { erc20Abi, performanceEscrowAbi } from "@nundina/shared/abis";
import { closeDb, db } from "../src/db/client.js";
import { purchases, relayedTxs, signalDrafts, signals, users } from "../src/db/schema.js";
import { resetEnv } from "../src/env.js";
import { stopQueue } from "../src/jobs/queue.js";
import { processVerify } from "../src/jobs/hspRetry.js";
import { log, testLogLines } from "../src/lib/log.js";
import { buyAndPay as payOf, newBuyer as buyerOf, signMandate, type Buyer } from "./buyer.js";
import { canRunChain, startChain, type Chain } from "./chain.js";
import { getJson, INTERNAL, makeProvider, postJson } from "./helpers.js";

const PRICE = 1_000_000n; // 1 USDT
const escrow = contractAddress(31337, "PerformanceEscrow");

describe.skipIf(!canRunChain)("purchases (DirectRail on anvil)", () => {
  const provider = privateKeyToAccount(generatePrivateKey());
  let chain: Chain;
  let signalId: bigint;

  const newBuyer = (usd = "5") => buyerOf(chain, usd);
  const buyAndPay = (b: Buyer, opts: { amount?: bigint; to?: Hex } = {}) => payOf(chain, b, signalId, PRICE, opts);

  beforeAll(async () => {
    chain = await startChain();
    await chain.registerProvider(provider, { bondUsd: "3" }); // capacity: 3 buyers at 1 USDT
    const { userId } = await makeProvider({ address: provider.address });
    ({ signalId } = await chain.commitViaApi(provider, userId, PRICE));
  });

  afterAll(async () => {
    await stopQueue();
    await closeDb();
    chain?.stop();
  });

  it("intent → ERC-20 transfer → submit → ACCEPT → credit on-chain → buyer decrypts the signal", async () => {
    const b = await newBuyer();
    const { purchaseId } = await buyAndPay(b);

    const r = await processVerify(purchaseId);
    expect(r.status).toBe("KEY_SENT");
    const paid = await chain.pub.readContract({ address: escrow, abi: performanceEscrowAbi, functionName: "paid", args: [signalId, b.account.address] });
    expect(paid).toBe(PRICE);

    const view = await getJson(`/purchases/${purchaseId}`, b.headers);
    expect(view.body.status).toBe("KEY_SENT");
    expect(view.body.paymentId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(view.body.creditedTx).toMatch(/^0x/);

    const k = await getJson(`/purchases/${purchaseId}/key`, b.headers);
    expect(k.status).toBe(200);
    const aesKey = unwrapKey(b.enc.privateKey, k.body.wrappedKey);
    const body = decryptSignalBody<{ entry: string; takeProfit: string }>(aesKey, k.body.ciphertext, k.body.iv);
    expect(body.entry).toBe("8150000000000");
    expect(body.takeProfit).toBe("8300000000000");

    // replaying the verification never credits twice
    const again = await processVerify(purchaseId);
    expect(again.status).toBe("KEY_SENT");
    const credits = await db().select().from(relayedTxs).where(eq(relayedTxs.idempotencyKey, `credit:${purchaseId}`));
    expect(credits).toHaveLength(1);

    // the same purchase cannot be bought again
    expect((await postJson("/purchases", { signalId: signalId.toString() }, b.headers)).status).toBe(409);
  });

  it("key endpoint is 403 for anyone but the buyer", async () => {
    const [p] = await db().select().from(purchases).where(eq(purchases.status, "KEY_SENT")).limit(1);
    const stranger = await newBuyer("0");
    expect((await getJson(`/purchases/${p!.id}/key`, stranger.headers)).status).toBe(403);
    expect((await getJson(`/purchases/${p!.id}/key`)).status).toBe(401);
  });

  it("re-using another payment's transaction is refused", async () => {
    const [p] = await db().select().from(purchases).where(eq(purchases.status, "KEY_SENT")).limit(1);
    const b = await newBuyer();
    const created = await postJson("/purchases", { signalId: signalId.toString() }, b.headers);
    const sub = await postJson(
      `/purchases/${created.body.purchaseId}/submit`,
      { mandateSig: await signMandate(b.account, created.body.intent), txHash: p!.txHash },
      { ...b.headers, "idempotency-key": "reuse" },
    );
    expect(sub.status).toBe(409);
  });

  it("wrong amount → POLICY, and the transfer is returned to the payer", async () => {
    const b = await newBuyer();
    const before = await chain.pub.readContract({ address: chain.usdt, abi: erc20Abi, functionName: "balanceOf", args: [b.account.address] });
    const { purchaseId } = await buyAndPay(b, { amount: PRICE / 2n });
    const r = await processVerify(purchaseId);
    expect(r.status).toBe("REJECTED");
    const p = await db().query.purchases.findFirst({ where: eq(purchases.id, purchaseId) });
    expect(p?.outcomeClass).toBe("POLICY");
    expect(p?.recoveryTx).toMatch(/^0x/);
    const after = await chain.pub.readContract({ address: chain.usdt, abi: erc20Abi, functionName: "balanceOf", args: [b.account.address] });
    expect(after).toBe(before);
    expect((await getJson(`/purchases/${purchaseId}/key`, b.headers)).status).toBe(409);
  });

  it("transfer to the wrong address → POLICY", async () => {
    const b = await newBuyer();
    const { purchaseId } = await buyAndPay(b, { to: privateKeyToAccount(generatePrivateKey()).address });
    const r = await processVerify(purchaseId);
    expect(r.status).toBe("REJECTED");
    const p = await db().query.purchases.findFirst({ where: eq(purchases.id, purchaseId) });
    expect(p?.outcomeClass).toBe("POLICY");
    expect(p?.recoveryTx).toBeNull();
  });

  it("a not-yet-mined transaction is RETRYABLE with back-off", async () => {
    const b = await newBuyer();
    const created = await postJson("/purchases", { signalId: signalId.toString() }, b.headers);
    const fakeTx = keccak256("0x1234");
    await postJson(
      `/purchases/${created.body.purchaseId}/submit`,
      { mandateSig: await signMandate(b.account, created.body.intent), txHash: fakeTx },
      { ...b.headers, "idempotency-key": "retry" },
    );
    expect(await processVerify(created.body.purchaseId, 0)).toEqual({ status: "RETRY", inS: 5 });
    expect((await processVerify(created.body.purchaseId, 5)).status).toBe("FAILED_RETRYABLE");
  });

  it("capacity full → 409 before any payment", async () => {
    const poor = privateKeyToAccount(generatePrivateKey());
    await chain.registerProvider(poor); // no bond
    const { userId } = await makeProvider({ address: poor.address });
    const { signalId: sid } = await chain.commitViaApi(poor, userId, PRICE);
    const b = await newBuyer();
    const r = await postJson("/purchases", { signalId: sid.toString() }, b.headers);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("capacity_full");
  });

  it("requires an encryption key and refuses self-purchase", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const [u] = await db().insert(users).values({ wallet: account.address.toLowerCase() }).returning();
    const r = await postJson("/purchases", { signalId: signalId.toString() }, { ...INTERNAL, "x-act-as-user": String(u!.id) });
    expect(r.body.error.code).toBe("no_encryption_key");
    const own = await db().query.users.findFirst({ where: eq(users.wallet, provider.address.toLowerCase()) });
    const self = await postJson("/purchases", { signalId: signalId.toString() }, { ...INTERNAL, "x-act-as-user": String(own!.id) });
    expect(self.status).toBe(403);
  });

  it("USDC.e fast path credits in one relayed transaction", async () => {
    process.env.FAST_PATH_ENABLED = "true";
    resetEnv();
    const p2 = privateKeyToAccount(generatePrivateKey());
    await chain.registerProvider(p2, { bondUsd: "2" });
    const { userId } = await makeProvider({ address: p2.address });
    const { signalId: sid } = await chain.commitViaApi(p2, userId, PRICE);
    const b = await newBuyer("0");
    const token = usdcE(31337);
    await chain.mint(token, b.account, PRICE);
    const created = await postJson("/purchases", { signalId: sid.toString(), token: "USDC_E" }, b.headers);
    expect(created.status).toBe(201);
    const nonce = keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }], [sid, b.account.address]));
    const authorization = { from: b.account.address, to: escrow, value: PRICE.toString(), validAfter: "0", validBefore: String(Math.floor(Date.now() / 1000) + 3600 * 24), nonce };
    const signature = await b.account.signTypedData({
      domain: { name: "Bridged USDC (test)", version: "2", chainId: 31337, verifyingContract: token },
      types: {
        ReceiveWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "ReceiveWithAuthorization",
      message: { ...authorization, value: PRICE, validAfter: 0n, validBefore: BigInt(authorization.validBefore), nonce: nonce as Hex },
    });
    const r = await postJson(`/purchases/${created.body.purchaseId}/authorize`, { authorization, signature }, b.headers);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("KEY_SENT");
    expect(r.body.rail).toBe("eip3009");
  });

  it("once a signal is paid in one token, a buyer asking for the other is refused before paying", async () => {
    const p3 = privateKeyToAccount(generatePrivateKey());
    await chain.registerProvider(p3, { bondUsd: "2" });
    const { userId } = await makeProvider({ address: p3.address });
    const { signalId: sid } = await chain.commitViaApi(p3, userId, PRICE);
    const first = await newBuyer();
    const { purchaseId } = await payOf(chain, first, sid, PRICE);
    expect((await processVerify(purchaseId)).status).toBe("KEY_SENT");

    const second = await newBuyer();
    const wrong = await postJson("/purchases", { signalId: sid.toString(), token: "USDC_E" }, second.headers);
    expect(wrong.status).toBe(409);
    expect(wrong.body.error.code).toBe("token_locked");
    expect(wrong.body.error.details).toEqual({ token: "USDT" });
    const right = await postJson("/purchases", { signalId: sid.toString(), token: "USDT" }, second.headers);
    expect(right.status).toBe(201);
  });

  it("a free signal unlocks in one call: no payment, no bond, key delivered", async () => {
    const own = await db().query.users.findFirst({ where: eq(users.wallet, provider.address.toLowerCase()) });
    const { signalId: freeId } = await chain.commitViaApi(provider, own!.id, 0n);
    const b = await newBuyer("0");
    const r = await postJson("/purchases", { signalId: freeId.toString() }, b.headers);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: "KEY_SENT", intent: null });

    const k = await getJson(`/purchases/${r.body.purchaseId}/key`, b.headers);
    const body = decryptSignalBody<{ entry: string }>(unwrapKey(b.enc.privateKey, k.body.wrappedKey), k.body.ciphertext, k.body.iv);
    expect(body.entry).toBe("8150000000000");
    // asking again returns the same claim instead of an error
    const again = await postJson("/purchases", { signalId: freeId.toString() }, b.headers);
    expect(again.body.purchaseId).toBe(r.body.purchaseId);
  });

  it("a confirm cut off after the commit was mined is finished by the retry, key kept", async () => {
    const own = await db().query.users.findFirst({ where: eq(users.wallet, provider.address.toLowerCase()) });
    const asUser = { ...INTERNAL, "x-act-as-user": String(own!.id) };
    const { signalId: id, draftId, signal } = await chain.commitViaApi(provider, own!.id, 0n);
    // what production saw: mined on-chain, then the API errored before saving anything
    await db().update(signals).set({ ciphertext: null, aesKeyEnc: null, saltEnc: null }).where(eq(signals.id, id));
    await db().update(signalDrafts).set({ status: "prepared", signalId: null }).where(eq(signalDrafts.id, draftId));

    const retry = await postJson(`/drafts/${draftId}/prepare`, signal, asUser);
    expect(retry.status).toBe(409);
    expect(retry.body.error).toMatchObject({ code: "already_committed", details: { signalId: id.toString() } });
    const row = await db().query.signals.findFirst({ where: eq(signals.id, id) });
    expect(row?.aesKeyEnc).toBeTruthy();

    const b = await newBuyer("0");
    const r = await postJson("/purchases", { signalId: id.toString() }, b.headers);
    expect(r.body.status).toBe("KEY_SENT");
  });

  it("a signal without key material can't be bought or claimed, and leaves no claim behind", async () => {
    const own = await db().query.users.findFirst({ where: eq(users.wallet, provider.address.toLowerCase()) });
    const { signalId: id } = await chain.commitViaApi(provider, own!.id, 0n);
    await db().update(signals).set({ aesKeyEnc: null }).where(eq(signals.id, id));
    const b = await newBuyer("0");
    const r = await postJson("/purchases", { signalId: id.toString() }, b.headers);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("no_key_material");
    expect(await db().select().from(purchases).where(eq(purchases.signalId, id))).toHaveLength(0);
  });

  it("never logs plaintext, keys or salts", async () => {
    log.info({ plaintext: "SECRET-PLAINTEXT", nested: { salt: "0xSECRETSALT", aesKey: "SECRETKEY" } }, "redaction check");
    const all = testLogLines.join("\n");
    expect(all).toContain("redaction check");
    expect(all).not.toContain("SECRET-PLAINTEXT");
    expect(all).not.toContain("0xSECRETSALT");
    expect(all).not.toContain("SECRETKEY");
    // the signal's levels were handled in this run but never logged
    expect(all).not.toContain("8150000000000");
    expect(all).not.toContain("8300000000000");
  });
});
