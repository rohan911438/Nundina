/** Buyer helpers for integration tests: a funded wallet with a user row, and the DirectRail purchase flow. */
import { expect } from "vitest";
import type { Hex, PrivateKeyAccount } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ENCRYPTION_KEY_MESSAGE, contractAddress, deriveEncryptionKey } from "@nundina/shared";
import { db } from "../src/db/client.js";
import { users } from "../src/db/schema.js";
import type { Chain } from "./chain.js";
import { INTERNAL, postJson } from "./helpers.js";

/** A buyer with gas, USDT, a user row and a registered encryption key. */
export async function newBuyer(chain: Chain, usd = "5") {
  const account = privateKeyToAccount(generatePrivateKey());
  await chain.fund(account, usd);
  const [u] = await db().insert(users).values({ wallet: account.address.toLowerCase() }).returning();
  const enc = deriveEncryptionKey(await account.signMessage({ message: ENCRYPTION_KEY_MESSAGE }));
  const headers = { ...INTERNAL, "x-act-as-user": String(u!.id) };
  const r = await postJson("/me/encryption-key", { publicKey: enc.publicKey }, headers);
  expect(r.status).toBe(200);
  return { account, userId: u!.id, enc, headers };
}
export type Buyer = Awaited<ReturnType<typeof newBuyer>>;

export async function signMandate(account: PrivateKeyAccount, intent: any): Promise<Hex> {
  const td = intent.mandateTypedData;
  return account.signTypedData({
    domain: td.domain,
    types: td.types,
    primaryType: "Mandate",
    message: { ...td.message, amount: BigInt(td.message.amount), chainId: BigInt(td.message.chainId), deadline: BigInt(td.message.deadline) },
  });
}

/** Creates a purchase, pays it with an ERC-20 transfer and submits it. Verification is left to the caller. */
export async function buyAndPay(chain: Chain, b: Buyer, signalId: bigint, price: bigint, opts: { amount?: bigint; to?: Hex } = {}) {
  const escrow = contractAddress(31337, "PerformanceEscrow");
  const created = await postJson("/purchases", { signalId: signalId.toString() }, b.headers);
  expect(created.status).toBe(201);
  const { purchaseId, intent } = created.body;
  expect(intent.payee).toBe(escrow);
  const txHash = await chain.transfer(b.account, chain.usdt, opts.to ?? escrow, opts.amount ?? price);
  const sub = await postJson(
    `/purchases/${purchaseId}/submit`,
    { mandateSig: await signMandate(b.account, intent), txHash },
    { ...b.headers, "idempotency-key": `idem-${purchaseId}` },
  );
  expect(sub.status).toBe(202);
  return { purchaseId: purchaseId as string, txHash, intent };
}
