import { getAddress } from "viem";
import { fromUnits, usdcE } from "@nundina/shared";
import { env } from "./env.js";
import { ApiError, Nundina } from "./nundina.js";

/**
 * Pay-per-call for data tools, x402 style (HSP facilitator, USDC.e, EIP-3009 `exact` scheme).
 * TODO(confirm): swap the hand-rolled verify/settle calls for `x402Gate` from `@hsp/sdk` once
 * published; the wire format below is x402 v1, which the HSP guide (§6) follows.
 *
 * Order: x402 payment (tool arg `payment` or `X-PAYMENT` header) → prepaid credits on the
 * caller's API key → structured `payment_required` result.
 */
export interface PaymentRequirements {
  scheme: "exact";
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: "application/json";
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra: { name: string; version: string };
}

export type Paid = { via: "x402"; tx: string | null; payer: string | null } | { via: "credits"; remainingUsd: string };
export type Unpaid = { error: "payment_required" | "payment_invalid"; message: string; x402Version: 1; accepts: PaymentRequirements[]; credits: string };

const network = (chainId: number) => (chainId === 177 ? "hashkey" : chainId === 133 ? "hashkey-testnet" : `eip155:${chainId}`);

export function requirements(tool: string, price: bigint, description: string): PaymentRequirements {
  const e = env();
  return {
    scheme: "exact",
    network: network(e.CHAIN_ID),
    maxAmountRequired: price.toString(),
    resource: `${e.MCP_PUBLIC_URL}/mcp#${tool}`,
    description,
    mimeType: "application/json",
    payTo: e.MCP_PAY_TO ? getAddress(e.MCP_PAY_TO) : "",
    maxTimeoutSeconds: 120,
    asset: usdcE(e.CHAIN_ID),
    // TODO(confirm): USDC.e EIP-712 domain on HashKey
    extra: { name: "Bridged USDC (HashKey)", version: "2" },
  };
}

export type FacilitatorFetch = (url: string, init: RequestInit) => Promise<Response>;
let facilitatorFetch: FacilitatorFetch = (u, i) => fetch(u, i);
export const setFacilitatorFetch = (f: FacilitatorFetch) => {
  facilitatorFetch = f;
};

async function facilitator<T>(path: "verify" | "settle", body: unknown): Promise<T> {
  const res = await facilitatorFetch(`${env().HSP_FACILITATOR_URL!.replace(/\/$/, "")}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`facilitator /${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

function decodePayment(p: string): unknown {
  try {
    return JSON.parse(Buffer.from(p, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

/** Charges `price` for one call; returns how it was paid, or what the caller must do. */
export async function charge(opts: { tool: string; price: bigint; description: string; payment?: string; api: Nundina }): Promise<Paid | Unpaid> {
  const req = requirements(opts.tool, opts.price, opts.description);
  const creditsHint = "Or prepay credit on your agent API key (Authorization: Bearer nk_…); each call is debited.";
  const unpaid = (error: Unpaid["error"], message: string): Unpaid => ({ error, message, x402Version: 1, accepts: [req], credits: creditsHint });

  if (opts.payment) {
    if (!env().HSP_FACILITATOR_URL || !req.payTo) return unpaid("payment_invalid", "x402 facilitator is not configured on this server; use prepaid credits");
    const payload = decodePayment(opts.payment) as { x402Version?: number; payload?: { authorization?: { to?: string; value?: string } } } | null;
    const auth = payload?.payload?.authorization;
    if (!auth) return unpaid("payment_invalid", "payment must be a base64 x402 PaymentPayload (exact scheme, EIP-3009 authorization)");
    if (!auth.to || getAddress(auth.to) !== req.payTo) return unpaid("payment_invalid", `authorization must pay ${req.payTo}`);
    if (BigInt(auth.value ?? 0) < opts.price) return unpaid("payment_invalid", `authorization value must be at least ${opts.price}`);
    const body = { x402Version: 1, paymentPayload: payload, paymentRequirements: req };
    const v = await facilitator<{ isValid: boolean; invalidReason?: string; payer?: string }>("verify", body);
    if (!v.isValid) return unpaid("payment_invalid", `facilitator rejected the payment: ${v.invalidReason ?? "invalid"}`);
    const s = await facilitator<{ success: boolean; errorReason?: string; transaction?: string; payer?: string }>("settle", body);
    if (!s.success) return unpaid("payment_invalid", `settlement failed: ${s.errorReason ?? "unknown"}`);
    return { via: "x402", tx: s.transaction ?? null, payer: s.payer ?? v.payer ?? null };
  }

  if (opts.api.apiKey) {
    try {
      const r = await opts.api.post<{ creditsUsd: string }>("/me/credits/debit", { amount: opts.price.toString(), reason: opts.tool });
      return { via: "credits", remainingUsd: r.creditsUsd };
    } catch (e) {
      if (!(e instanceof ApiError) || (e.status !== 402 && e.code !== "agent_key_required")) throw e;
    }
  }
  return unpaid("payment_required", `${opts.tool} costs ${fromUnits(opts.price)} USDC.e per call. Pay with x402 (pass \`payment\`), or use an API key with prepaid credit.`);
}
