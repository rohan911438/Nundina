import { erc20Abi, getAddress, type Hex } from "viem";
import type { MandateTypedData, Nundina } from "./nundina.js";
import type { AgentWallet } from "./wallet.js";

/**
 * How an agent pays for a purchase intent. Same shapes as the API's PaymentRail (prompt 07):
 * sign the HSP mandate, move the funds to the escrow it names, hand both back to the API.
 *
 * Paths, in order of preference:
 *  1. `@hsp/mcp` hsp_quote → hsp_pay with SpendGuard (per-tx cap, daily cap, recipient = escrow).
 *     TODO(confirm): package not published yet; see NEEDS-FROM-USER.
 *  2. `@hsp/sdk` HSPClient.pay. TODO(confirm): same.
 *  3. Direct (this): the evm-transfer flow the API's DirectRail and HspRail both verify.
 */
export interface PayPath {
  readonly name: string;
  pay(intent: { mandateTypedData: MandateTypedData; payee: `0x${string}` }): Promise<{ mandateSig: Hex; txHash: Hex }>;
}

export interface SpendGuard {
  perTxCap: bigint;
  dailyCap: bigint;
  spentToday: bigint;
  recipients: string[];
}

/** Local mirror of SpendGuard's checks, applied before any path signs. */
export function guard(g: SpendGuard, payee: string, amount: bigint): string | null {
  if (!g.recipients.some((r) => r.toLowerCase() === payee.toLowerCase())) return `recipient ${payee} not allowed`;
  if (amount > g.perTxCap) return `amount ${amount} over per-tx cap ${g.perTxCap}`;
  if (g.spentToday + amount > g.dailyCap) return `daily cap ${g.dailyCap} reached`;
  return null;
}

export function directPay(w: AgentWallet): PayPath {
  return {
    name: "direct",
    async pay({ mandateTypedData: td }) {
      const m = td.message;
      const mandateSig = await w.account.signTypedData({
        domain: { ...td.domain, chainId: Number(td.domain.chainId) },
        types: td.types,
        primaryType: "Mandate",
        message: { ...m, amount: BigInt(m.amount), chainId: BigInt(m.chainId), deadline: BigInt(m.deadline) },
      });
      const txHash = await w.wallet.writeContract({
        address: getAddress(m.token),
        abi: erc20Abi,
        functionName: "transfer",
        args: [getAddress(m.payee), BigInt(m.amount)],
      });
      await w.pub.waitForTransactionReceipt({ hash: txHash });
      return { mandateSig, txHash };
    },
  };
}

const TERMINAL = new Set(["KEY_SENT", "SETTLED_WIN", "REFUNDED", "REJECTED", "FAILED_RETRYABLE", "FAILED"]);

/**
 * Buys one signal end to end: intent → guard → pay → submit → wait for the key.
 * `beforePay` runs right before money moves (the execution agent re-checks pause there).
 */
export async function buy(
  api: Nundina,
  path: PayPath,
  signalId: string,
  opts: { guard: SpendGuard; beforePay?: () => Promise<string | null>; timeoutMs?: number },
): Promise<{ purchaseId: string; status: string; amount: bigint; txHash?: Hex; blocked?: string }> {
  const p = await api.createPurchase(signalId);
  // TODO(hsp-pay-mandate): the HashKey Merchant gateway only offers a browser checkout until its
  // agent Payment Mandate endpoint is documented (NEEDS-FROM-USER), so agents skip instead of paying.
  if (!p.intent.mandateTypedData) return { purchaseId: p.purchaseId, status: "PENDING", amount: 0n, blocked: `HSP gateway checkout needs a browser: ${p.intent.checkout?.paymentUrl ?? "no payment_url"}` };
  const amount = BigInt(p.intent.mandateTypedData.message.amount);
  const blocked = guard(opts.guard, p.intent.payee, amount) ?? (await opts.beforePay?.()) ?? null;
  if (blocked) return { purchaseId: p.purchaseId, status: "PENDING", amount, blocked };
  const { mandateSig, txHash } = await path.pay({ mandateTypedData: p.intent.mandateTypedData, payee: p.intent.payee });
  let view = await api.submitPurchase(p.purchaseId, { mandateSig, txHash });
  const until = Date.now() + (opts.timeoutMs ?? 120_000);
  while (!TERMINAL.has(view.status) && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 2_000));
    view = await api.purchase(p.purchaseId);
  }
  return { purchaseId: p.purchaseId, status: view.status, amount, txHash };
}
