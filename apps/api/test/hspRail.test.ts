/** HspRail against a mocked Coordinator that follows the developer guide's shapes. */
import { afterAll, describe, expect, it } from "vitest";
import { keccak256, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { closeDb } from "../src/db/client.js";
import { HspRail } from "../src/payments/HspRail.js";
import type { MandateTypedData } from "../src/payments/PaymentRail.js";

afterAll(closeDb);

const adapter = privateKeyToAccount(generatePrivateKey());
const payer = privateKeyToAccount(generatePrivateKey());

type Handler = (method: string, path: string, body: any, headers: Record<string, string>) => { status: number; json: unknown };

function fakeCoordinator(h: Handler) {
  const calls: { method: string; path: string; body: any; headers: Record<string, string> }[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({ method, path, body, headers });
    const r = h(method, path, body, headers);
    return new Response(JSON.stringify(r.json), { status: r.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { f, calls };
}

const chains = { chains: [{ name: "hashkey-testnet", adapterAddress: adapter.address }] };

function rail(f: typeof fetch, pinned?: `0x${string}`) {
  return new HspRail({ coordinatorUrl: "https://coord.test", apiKey: "k", chain: "hashkey-testnet", pinnedAdapter: pinned, fetch: f });
}

async function intentAndSig(r: HspRail) {
  const intent = await r.createIntent({ signalId: 7n, payer: payer.address, token: payer.address, amount: 1_000_000n });
  const td = intent.mandateTypedData as MandateTypedData;
  const sig = await payer.signTypedData({
    domain: td.domain,
    types: td.types,
    primaryType: "Mandate",
    message: { ...td.message, amount: BigInt(td.message.amount), chainId: BigInt(td.message.chainId), deadline: BigInt(td.message.deadline) },
  });
  return { intent, sig };
}

describe("HspRail", () => {
  it("pins the adapter from /chains and refuses a mismatching out-of-band pin", async () => {
    const { f } = fakeCoordinator((_m, p) => (p === "/chains" ? { status: 200, json: chains } : { status: 404, json: {} }));
    expect(await rail(f).pinAdapter()).toBe(adapter.address);
    await expect(rail(f, privateKeyToAccount(generatePrivateKey()).address).pinAdapter()).rejects.toThrow(/mismatch/);
  });

  it("submit registers the mandate with a bearer key, then asks the coordinator to observe", async () => {
    const { f, calls } = fakeCoordinator((m, p) => (m === "POST" ? { status: p.endsWith("/observe") ? 202 : 201, json: {} } : { status: 200, json: chains }));
    const r = rail(f);
    const { intent, sig } = await intentAndSig(r);
    const txHash = keccak256(toHex("tx-1"));
    const { paymentId } = await r.submit({ intentId: intent.intentId, mandateSig: sig, txHash });
    expect(paymentId).toBe(intent.intentId);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /payments", `POST /payments/${paymentId}/observe`]);
    expect(calls[0]!.headers.authorization).toBe("Bearer k");
    expect(calls[1]!.body.txHash).toBe(txHash);
  });

  it("rejects a mandate not signed by the payer", async () => {
    const { f } = fakeCoordinator(() => ({ status: 201, json: {} }));
    const r = rail(f);
    const { intent } = await intentAndSig(r);
    const other = privateKeyToAccount(generatePrivateKey());
    const bad = await other.signMessage({ message: "nope" });
    await expect(r.submit({ intentId: intent.intentId, mandateSig: bad, txHash: keccak256(toHex("tx-2")) })).rejects.toThrow(/payer/);
  });

  it("verify: RETRYABLE without a receipt, coordinator POLICY passes through, foreign adapter signature is PERMANENT", async () => {
    let payment: unknown = { status: "PENDING", receipt: null };
    const { f } = fakeCoordinator((m, p) => {
      if (p === "/chains") return { status: 200, json: chains };
      if (m === "GET") return { status: 200, json: payment };
      return { status: 202, json: {} };
    });
    const r = rail(f);
    const { intent, sig } = await intentAndSig(r);
    const txHash = keccak256(toHex("tx-3"));
    await r.submit({ intentId: intent.intentId, mandateSig: sig, txHash });

    expect((await r.verify(intent.intentId)).outcomeClass).toBe("RETRYABLE");

    payment = { decision: { outcomeClass: "POLICY", reason: "kyc missing" } };
    const pol = await r.verify(intent.intentId);
    expect(pol.outcomeClass).toBe("POLICY");
    expect(pol.reason).toBe("kyc missing");

    const receiptHash = keccak256(toHex("receipt"));
    const forger = privateKeyToAccount(generatePrivateKey());
    payment = { receipt: { receiptHash, signature: await forger.sign({ hash: receiptHash }), txHash } };
    expect((await r.verify(intent.intentId)).outcomeClass).toBe("PERMANENT");

    payment = { receipt: { receiptHash, signature: await adapter.sign({ hash: receiptHash }), txHash: keccak256(toHex("other")) } };
    const wrongTx = await r.verify(intent.intentId);
    expect(wrongTx.outcomeClass).toBe("PERMANENT");
    expect(wrongTx.explorerUrl).toBe(`https://coord.test/explorer/payments/${intent.intentId}`);
  });
});
