import { z } from "zod";
import { txUrl } from "../chain.js";
import { fail, guarded, ok, type Ctx } from "./common.js";

export const getPurchaseInput = { purchaseId: z.string().uuid() };

export const getPurchaseOutput = {
  purchaseId: z.string(),
  signalId: z.string(),
  status: z.string(),
  amountUsd: z.string(),
  token: z.string(),
  hspPaymentId: z.string().nullable(),
  txHash: z.string().nullable(),
  creditedTx: z.string().nullable(),
  explorer: z.string().nullable(),
  keyReady: z.boolean(),
  rejectReason: z.string().nullable(),
};

export const getPurchaseMeta = {
  title: "Get a purchase",
  description: "Free. Status of one of your purchases (PENDING → SUBMITTED → CREDITED → KEY_SENT; refunds show as REFUNDED) with its HSP payment id and transactions. No plaintext: once keyReady, call buy_signal step 2 again (idempotent) for the encrypted delivery and decrypt it yourself.",
};

export function getPurchase(ctx: Ctx) {
  return (a: { purchaseId: string }) =>
    guarded(async () => {
      if (!ctx.api.apiKey) return fail("auth_required", "get_purchase needs your agent API key");
      const p = await ctx.api.get<any>(`/purchases/${a.purchaseId}`);
      return ok({
        purchaseId: p.id,
        signalId: p.signalId,
        status: p.status,
        amountUsd: p.amountUsd,
        token: p.token,
        hspPaymentId: p.paymentId ?? null,
        txHash: p.txHash ?? null,
        creditedTx: p.creditedTx ?? null,
        explorer: txUrl(p.creditedTx ?? p.txHash),
        keyReady: ["KEY_SENT", "SETTLED_WIN", "REFUNDED"].includes(p.status),
        rejectReason: p.rejectReason ?? null,
      });
    });
}
