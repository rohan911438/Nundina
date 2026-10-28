import { and, eq } from "drizzle-orm";
import type { Hex } from "viem";
import { db } from "../db/client.js";
import { purchases } from "../db/schema.js";
import { enqueue, JOBS } from "../jobs/queue.js";
import { log } from "../lib/log.js";
import { HspGatewayRail } from "./HspGatewayRail.js";
import { paymentRail } from "./index.js";

type Purchase = typeof purchases.$inferSelect;

/** What the gateway told us (webhook body or a `GET /merchant/payments` record). */
export interface GatewayUpdate {
  status: string;
  tx_signature?: string;
  status_reason?: string;
}

export function gatewayRail(): HspGatewayRail | null {
  const r = paymentRail();
  return r instanceof HspGatewayRail ? r : null;
}

/**
 * Moves a PENDING gateway purchase forward: a tx on chain → SUBMITTED + verify job (which re-checks
 * the gateway and the chain before any credit); `payment-failed` → REJECTED. Idempotent, so a replayed
 * webhook or a repeated poll is harmless.
 */
export async function applyGatewayUpdate(p: Purchase, u: GatewayUpdate): Promise<Purchase> {
  const rail = gatewayRail();
  if (!rail || p.status !== "PENDING" || !p.hspPaymentId) return p;
  if (u.status === "payment-failed") {
    const [r] = await db()
      .update(purchases)
      .set({ status: "REJECTED", outcomeClass: "PERMANENT", rejectReason: `gateway: ${u.status_reason ?? "payment failed"}`, updatedAt: new Date() })
      .where(and(eq(purchases.id, p.id), eq(purchases.status, "PENDING")))
      .returning();
    return r ?? p;
  }
  if (!u.tx_signature || !/^0x[0-9a-fA-F]{64}$/.test(u.tx_signature)) return p;
  const txHash = u.tx_signature.toLowerCase() as Hex;
  const dup = await db().query.purchases.findFirst({ where: eq(purchases.txHash, txHash) });
  if (dup && dup.id !== p.id) {
    log.warn({ purchaseId: p.id, txHash }, "gateway tx already used by another purchase");
    return p;
  }
  await rail.submit({ intentId: p.hspPaymentId, txHash });
  const [r] = await db()
    .update(purchases)
    .set({ status: "SUBMITTED", txHash, updatedAt: new Date() })
    .where(and(eq(purchases.id, p.id), eq(purchases.status, "PENDING")))
    .returning();
  if (r) await enqueue(JOBS.hspVerify, { purchaseId: p.id, attempt: 0 }, `verify:${p.id}:0`);
  return r ?? p;
}

/** Poll path (`POST /purchases/:id/sync`): ask the gateway, then apply. */
export async function syncGatewayPurchase(p: Purchase): Promise<Purchase> {
  const rail = gatewayRail();
  if (!rail || p.status !== "PENDING" || !p.hspPaymentId) return p;
  return applyGatewayUpdate(p, await rail.gatewayPayment(p.hspPaymentId));
}
