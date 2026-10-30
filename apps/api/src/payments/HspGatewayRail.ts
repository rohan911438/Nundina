import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { eq } from "drizzle-orm";
import { encodeAbiParameters, getAddress, keccak256, type Address, type Hex } from "viem";
import { fromUnits, paymentToken, usdcE } from "@nundina/shared";
import { db } from "../db/client.js";
import { railPayments } from "../db/schema.js";
import { env } from "../env.js";
import { addr } from "../chain/clients.js";
import { conflict, notFound } from "../lib/errors.js";
import { GatewayClient, loadMerchantKey, type GatewayPayment } from "./hspGateway.js";
import { observeTransfer } from "./observe.js";
import { purchaseReference, type CreateIntentParams, type Intent, type PaymentRail, type Verification } from "./PaymentRail.js";

/** What we keep per gateway order (rail_payments.mandate_json). */
export interface GatewayOrder {
  gateway: "hashkey-merchant";
  cartMandateId: string;
  paymentRequestId: string;
  paymentUrl: string;
  payer: Address;
  payee: Address;
  token: Address;
  amount: string;
  contents: Record<string, unknown>;
}

/** Gateway states we treat as paid (reorg risk "extremely low" or final). */
const PAID = ["payment-safe", "payment-finalized"];
const NETWORK: Record<number, string> = { 133: "hashkey-testnet", 177: "hashkey" };
const ZERO32 = `0x${"00".repeat(32)}` as Hex;
const CART_TTL_MS = 2 * 60 * 60_000;

/**
 * Live rail on the HashKey Merchant gateway (HSP). Per purchase we create a one-time order whose
 * Cart Mandate pays **our escrow** (`pay_to`); the payer authorises it at the gateway checkout
 * (`payment_url`) and the gateway broadcasts the EIP-3009 / Permit2 transfer. We learn the tx from the
 * webhook or by polling, then check the Transfer(payer → escrow, price) on-chain ourselves before
 * the credit signer attests the escrow credit. Gateway status alone never credits anything.
 *
 * TODO(hsp-pay-mandate): agents can't use the browser checkout. The gateway's
 * `/api/v1/payment/pay-mandate` (agent-built Payment Mandate) is not documented yet.
 */
export class HspGatewayRail implements PaymentRail {
  readonly name = "hsp" as const;

  /** `network` overrides the chain-id lookup (tests on anvil). */
  constructor(
    private readonly client: GatewayClient,
    private readonly opts: { network?: string } = {},
  ) {}

  static fromEnv(): HspGatewayRail {
    const e = env();
    if (!e.HSP_MERCHANT_APP_KEY || !e.HSP_MERCHANT_APP_SECRET) throw new Error("HSP gateway needs HSP_MERCHANT_APP_KEY and HSP_MERCHANT_APP_SECRET");
    const path = isAbsolute(e.HSP_MERCHANT_PRIVATE_KEY_PATH) ? e.HSP_MERCHANT_PRIVATE_KEY_PATH : join(import.meta.dirname, "..", "..", "..", "..", e.HSP_MERCHANT_PRIVATE_KEY_PATH);
    return new HspGatewayRail(
      new GatewayClient({
        baseUrl: e.HSP_MERCHANT_BASE_URL,
        appKey: e.HSP_MERCHANT_APP_KEY,
        appSecret: e.HSP_MERCHANT_APP_SECRET,
        merchantKey: loadMerchantKey(readFileSync(path, "utf8")),
        merchantName: e.HSP_MERCHANT_NAME,
      }),
    );
  }

  get appSecret() {
    return this.client.cfg.appSecret;
  }

  async createIntent(p: CreateIntentParams): Promise<Intent> {
    const chainId = env().CHAIN_ID;
    const network = this.opts.network ?? NETWORK[chainId];
    if (!network) throw new Error(`HSP gateway has no network for chain ${chainId}`);
    const payee = addr("PerformanceEscrow");
    const coin = getAddress(p.token) === getAddress(usdcE(chainId)) ? "USDC" : getAddress(p.token) === getAddress(paymentToken(chainId)) ? "USDT" : null;
    if (!coin) throw new Error(`token ${p.token} is not an HSP gateway token`);
    const cartMandateId = `nundina-${p.signalId}-${p.payer.slice(2, 10).toLowerCase()}-${Date.now().toString(36)}`;
    const paymentRequestId = `pr-${cartMandateId}`;
    const usd = fromUnits(p.amount);
    const contents = {
      id: cartMandateId,
      user_cart_confirmation_required: true,
      payment_request: {
        method_data: [
          {
            supported_methods: "https://www.x402.org/",
            data: { x402Version: 2, network, chain_id: chainId, contract_address: getAddress(p.token), pay_to: payee, coin },
          },
        ],
        details: {
          id: paymentRequestId,
          display_items: [{ label: `Signal #${p.signalId}`, amount: { currency: "USD", value: usd } }],
          total: { label: "Total", amount: { currency: "USD", value: usd } },
        },
      },
      cart_expiry: new Date(Date.now() + CART_TTL_MS).toISOString().replace(/\.\d{3}Z$/, "Z"),
      merchant_name: this.client.cfg.merchantName,
    };
    const res = await this.client.createOrder(contents, env().WEB_ORIGIN.split(",")[0]?.trim() || undefined);
    const order: GatewayOrder = {
      gateway: "hashkey-merchant",
      cartMandateId,
      paymentRequestId: res.payment_request_id ?? paymentRequestId,
      paymentUrl: res.payment_url,
      payer: getAddress(p.payer),
      payee,
      token: getAddress(p.token),
      amount: p.amount.toString(),
      contents,
    };
    await db().insert(railPayments).values({ id: cartMandateId, rail: this.name, mandateJson: order });
    return {
      intentId: cartMandateId,
      payee,
      reference: purchaseReference(p.signalId, p.payer),
      checkout: { paymentUrl: res.payment_url, paymentRequestId: order.paymentRequestId, cartMandateId },
    };
  }

  /** Records the gateway's on-chain tx for an order (from the webhook or a poll). */
  async submit(p: { intentId: string; txHash: Hex }) {
    const row = await db().query.railPayments.findFirst({ where: eq(railPayments.id, p.intentId) });
    if (!row) throw notFound("Payment intent");
    if (row.txHash && row.txHash !== p.txHash.toLowerCase()) throw conflict("already_submitted", "Order already has a transaction");
    const used = await db().query.railPayments.findFirst({ where: eq(railPayments.txHash, p.txHash.toLowerCase()) });
    if (used && used.id !== row.id) throw conflict("tx_reused", "Transaction already used for another payment");
    await db().update(railPayments).set({ txHash: p.txHash.toLowerCase(), status: "SUBMITTED", updatedAt: new Date() }).where(eq(railPayments.id, row.id));
    return { paymentId: row.id };
  }

  /** The gateway's current record for an order. */
  async gatewayPayment(intentId: string): Promise<GatewayPayment> {
    const order = await this.order(intentId);
    return this.client.payment(order.paymentRequestId);
  }

  async verify(paymentId: string): Promise<Verification> {
    const order = await this.order(paymentId);
    const base = { amount: BigInt(order.amount), payer: order.payer, payee: order.payee, token: order.token, txHash: ZERO32 };
    const gp = await this.client.payment(order.paymentRequestId).catch((e: Error) => e);
    if (gp instanceof Error) return { ...base, outcomeClass: "RETRYABLE", receiptHash: ZERO32, reason: gp.message };
    if (gp.status === "payment-failed") return { ...base, outcomeClass: "PERMANENT", receiptHash: ZERO32, reason: `gateway: ${gp.status_reason ?? "payment failed"}` };
    if (!PAID.includes(gp.status) || !gp.tx_signature) return { ...base, outcomeClass: "RETRYABLE", receiptHash: ZERO32, reason: `gateway status ${gp.status}` };

    const txHash = gp.tx_signature as Hex;
    // never trust the gateway's word for it: the escrow must have received exactly the price from the payer
    const obs = await observeTransfer(txHash, { token: order.token, from: order.payer, to: order.payee, amount: base.amount });
    const receiptHash = keccak256(encodeAbiParameters([{ type: "string" }, { type: "string" }, { type: "bytes32" }], ["hsp-gateway", order.paymentRequestId, txHash]));
    await db()
      .update(railPayments)
      .set({
        txHash: txHash.toLowerCase(),
        outcomeClass: obs.outcomeClass,
        status: obs.outcomeClass === "ACCEPT" ? "VERIFIED" : obs.outcomeClass === "RETRYABLE" ? "SUBMITTED" : "REJECTED",
        receiptJson: { gateway: gp },
        receiptHash: obs.outcomeClass === "ACCEPT" ? receiptHash : null,
        updatedAt: new Date(),
      })
      .where(eq(railPayments.id, paymentId));
    if (obs.outcomeClass !== "ACCEPT") return { ...base, txHash, outcomeClass: obs.outcomeClass, receiptHash: ZERO32, reason: obs.reason };
    return { ...base, txHash, outcomeClass: "ACCEPT", receiptHash };
  }

  private async order(id: string): Promise<GatewayOrder> {
    const row = await db().query.railPayments.findFirst({ where: eq(railPayments.id, id) });
    if (!row) throw notFound("Payment");
    return row.mandateJson as GatewayOrder;
  }
}
