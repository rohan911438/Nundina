import { eq, sql as dsql } from "drizzle-orm";
import { encodeFunctionData, getAddress, type Address, type Hex } from "viem";
import { performanceEscrowAbi } from "@nundina/shared/abis";
import { db } from "../db/client.js";
import { purchases, signals } from "../db/schema.js";
import { addr } from "../chain/clients.js";
import { relay } from "../chain/relayer.js";
import { ApiError } from "../lib/errors.js";
import { log } from "../lib/log.js";
import { wrapKeyFor } from "../keys/keyService.js";
import { paymentRail } from "../payments/index.js";
import { signCredit, signRecover } from "../payments/creditSigner.js";
import { observeTransfer } from "../payments/observe.js";
import { enqueue, JOBS } from "./queue.js";

/** Back-off for RETRYABLE outcomes (seconds). After the last one the purchase is FAILED_RETRYABLE. */
export const BACKOFF_S = [5, 15, 45, 120, 300];

export type VerifyResult =
  | { status: "KEY_SENT" | "CREDITED"; creditedTx: string }
  | { status: "RETRY"; inS: number }
  | { status: "FAILED_RETRYABLE" | "REJECTED"; reason: string }
  | { status: "SKIPPED"; reason: string };

/** Subquery: credited purchases of a signal. */
export const paidCount = (signalId: bigint) =>
  dsql<number>`(select count(*)::int from purchases where signal_id = ${signalId} and status in ('CREDITED','KEY_SENT','SETTLED_WIN','REFUNDED'))`;

const ZERO32 = `0x${"00".repeat(32)}` as Hex;

async function setStatus(id: string, fields: Partial<typeof purchases.$inferInsert>) {
  await db()
    .update(purchases)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(purchases.id, id));
}

/** Delivers the key for a credited purchase (idempotent). */
async function deliver(purchaseId: string, signalId: bigint) {
  await wrapKeyFor(purchaseId);
  await setStatus(purchaseId, { status: "KEY_SENT" });
  await enqueue(JOBS.notifyKeyDelivered, { purchaseId, signalId: signalId.toString() }, `key:${purchaseId}`);
}

/**
 * The `hsp.verify` job. ACCEPT → sign Credit → relay creditPayment → wrap key → KEY_SENT.
 * RETRYABLE → re-enqueue with back-off. POLICY/PERMANENT → REJECTED, and any tokens that did reach
 * the escrow are returned to the payer via `recoverUncredited`.
 * Safe to run more than once for the same purchase: it never credits twice.
 */
export async function processVerify(purchaseId: string, attempt = 0): Promise<VerifyResult> {
  const p = await db().query.purchases.findFirst({ where: eq(purchases.id, purchaseId) });
  if (!p) return { status: "SKIPPED", reason: "unknown purchase" };
  if (p.creditedTx && p.status !== "CREDITED") return { status: "KEY_SENT", creditedTx: p.creditedTx };
  if (p.status === "CREDITED" && p.creditedTx) {
    await deliver(p.id, p.signalId);
    return { status: "KEY_SENT", creditedTx: p.creditedTx };
  }
  if (p.status !== "SUBMITTED" || !p.hspPaymentId) return { status: "SKIPPED", reason: `status ${p.status}` };

  const rail = paymentRail();
  const v = await rail.verify(p.hspPaymentId);
  const explorerUrl = v.explorerUrl ?? null;

  if (v.outcomeClass === "RETRYABLE") {
    if (attempt >= BACKOFF_S.length) {
      await setStatus(p.id, { status: "FAILED_RETRYABLE", outcomeClass: "RETRYABLE", rejectReason: v.reason, explorerUrl });
      return { status: "FAILED_RETRYABLE", reason: v.reason ?? "gave up" };
    }
    const inS = BACKOFF_S[attempt]!;
    await enqueue(JOBS.hspVerify, { purchaseId, attempt: attempt + 1 }, { startAfter: inS, singletonKey: `verify:${purchaseId}:${attempt + 1}` });
    return { status: "RETRY", inS };
  }

  // Defence in depth: the verified payment must be exactly this purchase.
  const escrow = addr("PerformanceEscrow");
  const mismatch =
    v.outcomeClass === "ACCEPT" &&
    (getAddress(v.payer) !== getAddress(p.buyerAddress) ||
      v.amount !== BigInt(p.amount) ||
      getAddress(v.token) !== getAddress(p.token) ||
      getAddress(v.payee) !== escrow);
  if (v.outcomeClass !== "ACCEPT" || mismatch) {
    const reason = mismatch ? "verified payment does not match the purchase" : (v.reason ?? v.outcomeClass);
    await setStatus(p.id, { status: "REJECTED", outcomeClass: mismatch ? "POLICY" : v.outcomeClass, rejectReason: reason, explorerUrl });
    await tryRecover(p.id, p.token as Address, p.buyerAddress as Address, p.txHash as Hex | null, BigInt(p.amount));
    return { status: "REJECTED", reason };
  }

  const txHash = (p.txHash ?? ZERO32) as Hex;
  const sig = await signCredit({
    signalId: p.signalId,
    subscriber: getAddress(p.buyerAddress),
    token: getAddress(p.token),
    amount: BigInt(p.amount),
    receiptHash: v.receiptHash,
    txHash,
  });
  let creditedTx: string;
  try {
    const r = await relay({
      key: `credit:${p.id}`,
      purpose: "creditPayment",
      to: escrow,
      data: encodeFunctionData({
        abi: performanceEscrowAbi,
        functionName: "creditPayment",
        args: [p.signalId, getAddress(p.buyerAddress), getAddress(p.token), BigInt(p.amount), v.receiptHash, txHash, sig],
      }),
    });
    creditedTx = r.hash;
  } catch (e) {
    if (e instanceof ApiError && (e.code === "tx_would_revert" || e.code === "tx_failed" || e.code === "tx_reverted")) {
      const reason = `escrow refused credit: ${e.message}`;
      await setStatus(p.id, { status: "REJECTED", outcomeClass: "PERMANENT", rejectReason: reason, receiptHash: v.receiptHash, explorerUrl });
      // TxUsed / ReceiptUsed means this transfer was already credited elsewhere: nothing to recover.
      if (!/TxUsed|ReceiptUsed|AlreadyPaid/.test(e.message)) {
        await tryRecover(p.id, p.token as Address, p.buyerAddress as Address, p.txHash as Hex | null, BigInt(p.amount));
      }
      return { status: "REJECTED", reason };
    }
    throw e; // transient relayer problem: let pg-boss retry the job
  }

  await db().transaction(async (tx) => {
    await tx
      .update(purchases)
      .set({ status: "CREDITED", outcomeClass: "ACCEPT", receiptHash: v.receiptHash, creditedTx, explorerUrl, updatedAt: new Date() })
      .where(eq(purchases.id, p.id));
    await tx
      .update(signals)
      // absolute count, so the indexer and this job never double count
      .set({ purchaseCount: paidCount(p.signalId), updatedAt: new Date() })
      .where(eq(signals.id, p.signalId));
  });
  log.info({ purchaseId: p.id, signalId: p.signalId.toString(), creditedTx }, "payment credited");
  await deliver(p.id, p.signalId);
  return { status: "KEY_SENT", creditedTx };
}

/** Returns tokens a rejected payment sent to the escrow back to the payer (credit-signer authorised). */
async function tryRecover(purchaseId: string, token: Address, payer: Address, txHash: Hex | null, expected: bigint) {
  if (!txHash) return;
  try {
    const escrow = addr("PerformanceEscrow");
    const obs = await observeTransfer(txHash, { token, from: payer, to: escrow, amount: expected });
    if (obs.sentToPayee === 0n) return;
    const sig = await signRecover({ token: getAddress(token), payer: getAddress(payer), amount: obs.sentToPayee, txHash });
    const r = await relay({
      key: `recover:${txHash}`,
      purpose: "recoverUncredited",
      to: escrow,
      data: encodeFunctionData({
        abi: performanceEscrowAbi,
        functionName: "recoverUncredited",
        args: [getAddress(token), getAddress(payer), obs.sentToPayee, txHash, sig],
      }),
    });
    await setStatus(purchaseId, { recoveryTx: r.hash });
    log.info({ purchaseId, amount: obs.sentToPayee.toString(), tx: r.hash }, "uncredited transfer returned to payer");
  } catch (err) {
    log.error({ err, purchaseId }, "recoverUncredited failed; needs manual follow-up");
  }
}
