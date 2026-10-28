/** HashKey Merchant gateway rail: signing primitives, then the full purchase flow on anvil against a fake gateway. */
import { createHmac, createPublicKey, generateKeyPairSync, verify as verifySig, type KeyObject } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { contractAddress } from "@nundina/shared";
import { performanceEscrowAbi } from "@nundina/shared/abis";
import { closeDb, db } from "../src/db/client.js";
import { purchases } from "../src/db/schema.js";
import { stopQueue } from "../src/jobs/queue.js";
import { processVerify } from "../src/jobs/hspRetry.js";
import { HspGatewayRail } from "../src/payments/HspGatewayRail.js";
import { canonicalJson, GatewayClient, merchantAuthorization, requestSignature, sha256Hex, verifyWebhook } from "../src/payments/hspGateway.js";
import { setPaymentRail } from "../src/payments/index.js";
import { newBuyer, type Buyer } from "./buyer.js";
import { canRunChain, startChain, type Chain } from "./chain.js";
import { app, getJson, makeProvider, postJson } from "./helpers.js";

const APP_SECRET = "test-app-secret";
const { privateKey: merchantKey } = generateKeyPairSync("ec", { namedCurve: "secp256k1" });
const merchantPub = createPublicKey(merchantKey);

function decodeJwt(jwt: string, pub: KeyObject) {
  const [h, c, s] = jwt.split(".");
  const ok = verifySig("sha256", Buffer.from(`${h}.${c}`), { key: pub, dsaEncoding: "ieee-p1363" }, Buffer.from(s!, "base64url"));
  return { ok, header: JSON.parse(Buffer.from(h!, "base64url").toString()), claims: JSON.parse(Buffer.from(c!, "base64url").toString()) };
}

const webhookSig = (body: string, t = Math.floor(Date.now() / 1000), secret = APP_SECRET) =>
  `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;

/** A gateway that checks our HMAC headers like the real one and keeps one payment record per order. */
function fakeGateway() {
  const orders = new Map<string, { body: any; payment: Record<string, unknown> }>();
  const calls: { method: string; path: string; query: string }[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const method = init.method ?? "GET";
    const headers = init.headers as Record<string, string>;
    const body = init.body ? String(init.body) : undefined;
    const query = u.search.replace(/^\?/, "");
    calls.push({ method, path: u.pathname, query });
    const expected = requestSignature(APP_SECRET, { method, path: u.pathname, query, body, timestamp: headers["x-timestamp"]!, nonce: headers["x-nonce"]! });
    const reply = (json: unknown, status = 200) => new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
    if (headers["x-app-key"] !== "ak_test" || headers["x-signature"] !== expected) return reply({ code: 10001, msg: "bad signature" }, 401);
    if (method === "POST" && u.pathname === "/api/v1/merchant/orders") {
      const b = JSON.parse(body!);
      const id = b.cart_mandate.contents.id as string;
      const prId = b.cart_mandate.contents.payment_request.details.id as string;
      orders.set(prId, { body: b, payment: { cart_mandate_id: id, payment_request_id: prId, status: "payment-required" } });
      return reply({ code: 0, msg: "success", data: { payment_request_id: prId, payment_url: `https://pay.test/${prId}`, multi_pay: false } });
    }
    if (method === "GET" && u.pathname === "/api/v1/merchant/payments") {
      const o = orders.get(u.searchParams.get("payment_request_id")!);
      return o ? reply({ code: 0, msg: "success", data: o.payment }) : reply({ code: 40400, msg: "not found" }, 404);
    }
    return reply({ code: 40400, msg: "not found" }, 404);
  }) as typeof fetch;
  const order = (prId: string) => orders.get(prId)!;
  return { f, calls, order, orders };
}

describe("HSP gateway signing", () => {
  it("canonical JSON sorts keys recursively and is compact", () => {
    expect(canonicalJson({ b: 1, a: { d: [{ z: 1, y: 2 }], c: "x" } })).toBe('{"a":{"c":"x","d":[{"y":2,"z":1}]},"b":1}');
  });

  it("request signature follows METHOD\\nPATH\\nQUERY\\nbodyHash\\nts\\nnonce", () => {
    const body = '{"a":1}';
    const msg = ["POST", "/api/v1/merchant/orders", "", sha256Hex(body), "1709123456", "a3f1b2c4d5e6"].join("\n");
    expect(requestSignature(APP_SECRET, { method: "post", path: "/api/v1/merchant/orders", query: "", body, timestamp: "1709123456", nonce: "a3f1b2c4d5e6" })).toBe(
      createHmac("sha256", APP_SECRET).update(msg).digest("hex"),
    );
    const get = ["GET", "/api/v1/merchant/payments", "cart_mandate_id=X", "", "1", "n"].join("\n");
    expect(requestSignature(APP_SECRET, { method: "GET", path: "/api/v1/merchant/payments", query: "cart_mandate_id=X", timestamp: "1", nonce: "n" })).toBe(
      createHmac("sha256", APP_SECRET).update(get).digest("hex"),
    );
  });

  it("merchant_authorization is an ES256K JWT over the cart hash", () => {
    const contents = { id: "c1", z: [1, 2], a: "x" };
    const jwt = merchantAuthorization(merchantKey, "Nundina", contents, 1_700_000_000);
    const { ok, header, claims } = decodeJwt(jwt, merchantPub);
    expect(ok).toBe(true);
    expect(header).toEqual({ alg: "ES256K", typ: "JWT" });
    expect(claims).toMatchObject({ iss: "Nundina", sub: "Nundina", aud: "HashkeyMerchant", iat: 1_700_000_000, exp: 1_700_003_600 });
    expect(claims.cart_hash).toBe(sha256Hex('{"a":"x","id":"c1","z":[1,2]}'));
    expect(claims.jti).toMatch(/^JWT-1700000000-/);
  });

  it("webhook signature: good, tampered, wrong secret, stale, malformed", () => {
    const body = '{"status":"payment-safe"}';
    const now = 1_700_000_000;
    expect(verifyWebhook(APP_SECRET, webhookSig(body, now), body, now)).toEqual({ ok: true });
    expect(verifyWebhook(APP_SECRET, webhookSig(body, now), body + " ", now)).toMatchObject({ ok: false, reason: "signature mismatch" });
    expect(verifyWebhook(APP_SECRET, webhookSig(body, now, "other"), body, now)).toMatchObject({ ok: false });
    expect(verifyWebhook(APP_SECRET, webhookSig(body, now - 301), body, now)).toMatchObject({ ok: false, reason: "timestamp out of tolerance" });
    expect(verifyWebhook(APP_SECRET, "v1=abc", body, now)).toMatchObject({ ok: false, reason: "malformed X-Signature" });
    expect(verifyWebhook(APP_SECRET, undefined, body, now)).toMatchObject({ ok: false });
  });
});

const PRICE = 1_000_000n;
const escrow = contractAddress(31337, "PerformanceEscrow");

describe.skipIf(!canRunChain)("HspGatewayRail purchases (anvil + fake gateway)", () => {
  const provider = privateKeyToAccount(generatePrivateKey());
  const gw = fakeGateway();
  let chain: Chain;
  let signalId: bigint;

  beforeAll(async () => {
    chain = await startChain();
    await chain.registerProvider(provider, { bondUsd: "3" });
    const { userId } = await makeProvider({ address: provider.address });
    ({ signalId } = await chain.commitViaApi(provider, userId, PRICE));
    const client = new GatewayClient({ baseUrl: "https://merchant.test", appKey: "ak_test", appSecret: APP_SECRET, merchantKey, merchantName: "Nundina", fetch: gw.f });
    setPaymentRail(new HspGatewayRail(client, { network: "hashkey-testnet" }));
  });

  afterAll(async () => {
    setPaymentRail(undefined);
    await stopQueue();
    await closeDb();
    chain?.stop();
  });

  async function order(b: Buyer) {
    const created = await postJson("/purchases", { signalId: signalId.toString() }, b.headers);
    expect(created.status).toBe(201);
    const { purchaseId, intent } = created.body;
    expect(intent.mandateTypedData).toBeUndefined();
    expect(intent.checkout.paymentUrl).toMatch(/^https:\/\/pay\.test\/pr-nundina-/);
    return { purchaseId: purchaseId as string, prId: intent.checkout.paymentRequestId as string, cartId: intent.checkout.cartMandateId as string };
  }

  const webhook = (body: unknown, sig?: string) => {
    const raw = JSON.stringify(body);
    return app.request("/hsp/webhook", { method: "POST", headers: { "content-type": "application/json", "x-signature": sig ?? webhookSig(raw) }, body: raw });
  };

  it("order pays the escrow → gateway settles → webhook → on-chain check → credit → key", async () => {
    const b = await newBuyer(chain);
    const { purchaseId, prId, cartId } = await order(b);

    const sent = gw.order(prId).body;
    const md = sent.cart_mandate.contents.payment_request.method_data[0].data;
    expect(md).toMatchObject({ network: "hashkey-testnet", chain_id: 31337, pay_to: escrow, coin: "USDT", contract_address: chain.usdt });
    expect(sent.cart_mandate.contents.payment_request.details.total.amount).toEqual({ currency: "USD", value: "1" });
    const jwt = decodeJwt(sent.cart_mandate.merchant_authorization, merchantPub);
    expect(jwt.ok).toBe(true);
    expect(jwt.claims.cart_hash).toBe(sha256Hex(canonicalJson(sent.cart_mandate.contents)));

    const view = await getJson(`/purchases/${purchaseId}`, b.headers);
    expect(view.body.status).toBe("PENDING");
    expect(view.body.paymentUrl).toBe(`https://pay.test/${prId}`);

    // the gateway broadcasts the payer's authorised transfer to our escrow
    const txHash = await chain.transfer(b.account, chain.usdt, escrow, PRICE);
    Object.assign(gw.order(prId).payment, { status: "payment-safe", tx_signature: txHash });

    expect((await webhook({ event_type: "payment", cart_mandate_id: cartId, status: "payment-safe", tx_signature: txHash }, "t=1,v1=00")).status).toBe(401);
    const res = await webhook({ event_type: "payment", cart_mandate_id: cartId, status: "payment-safe", tx_signature: txHash });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).status).toBe("SUBMITTED");
    // replayed webhook is harmless
    expect((await webhook({ event_type: "payment", cart_mandate_id: cartId, status: "payment-safe", tx_signature: txHash })).status).toBe(200);

    const r = await processVerify(purchaseId);
    expect(r.status).toBe("KEY_SENT");
    const paid = await chain.pub.readContract({ address: escrow, abi: performanceEscrowAbi, functionName: "paid", args: [signalId, b.account.address] });
    expect(paid).toBe(PRICE);
    expect((await getJson(`/purchases/${purchaseId}/key`, b.headers)).status).toBe(200);
  });

  it("gateway says paid but the escrow got less → no credit", async () => {
    const b = await newBuyer(chain);
    const { purchaseId, prId } = await order(b);
    const txHash = await chain.transfer(b.account, chain.usdt, escrow, PRICE - 1n);
    Object.assign(gw.order(prId).payment, { status: "payment-finalized", tx_signature: txHash });
    const s = await postJson(`/purchases/${purchaseId}/sync`, {}, b.headers);
    expect(s.status).toBe(200);
    const r = await processVerify(purchaseId);
    expect(r.status).not.toBe("KEY_SENT");
    const paid = await chain.pub.readContract({ address: escrow, abi: performanceEscrowAbi, functionName: "paid", args: [signalId, b.account.address] });
    expect(paid).toBe(0n);
  });

  it("payment-failed via poll → REJECTED; unknown orders are acknowledged and ignored", async () => {
    const b = await newBuyer(chain);
    const { purchaseId, prId } = await order(b);
    expect((await postJson(`/purchases/${purchaseId}/sync`, {}, b.headers)).body.status).toBe("PENDING");
    Object.assign(gw.order(prId).payment, { status: "payment-failed", status_reason: "broadcast never succeeded" });
    await postJson(`/purchases/${purchaseId}/sync`, {}, b.headers);
    const p = await db().query.purchases.findFirst({ where: eq(purchases.id, purchaseId) });
    expect(p!.status).toBe("REJECTED");
    expect(p!.rejectReason).toMatch(/broadcast never succeeded/);

    const res = await webhook({ event_type: "payment", cart_mandate_id: "not-ours", status: "payment-safe" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).ignored).toBe(true);
  });
});
