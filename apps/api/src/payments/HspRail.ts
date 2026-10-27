import { eq } from "drizzle-orm";
import { getAddress, isAddress, recoverAddress, type Address, type Hex } from "viem";
import { db } from "../db/client.js";
import { railPayments } from "../db/schema.js";
import { env } from "../env.js";
import { addr } from "../chain/clients.js";
import { ApiError, badRequest, notFound } from "../lib/errors.js";
import { log } from "../lib/log.js";
import { buildMandate, checkMandateSig } from "./MockRail.js";
import { observeTransfer } from "./observe.js";
import {
  mandateHash,
  type CreateIntentParams,
  type Intent,
  type MandateTypedData,
  type OutcomeClass,
  type PaymentRail,
  type Verification,
} from "./PaymentRail.js";

/**
 * Live HSP rail. Talks to the hosted Coordinator over its documented REST API
 * (`POST /payments`, `POST /payments/:id/observe`, `GET /payments/:id`, `GET /chains`).
 * The browser wallet signs the mandate and broadcasts the transfer itself; we only register,
 * observe, and verify locally against the adapter address pinned at boot.
 *
 * TODO(hsp-live): once the SDK repo is shared, swap the raw fetches for `HSPClient` and the
 * local checks in `verify()` for `HSPVerifier.verify(mandate, receipt, attestations)`.
 */
export interface HspConfig {
  coordinatorUrl: string;
  apiKey: string;
  chain: string;
  pinnedAdapter?: Address;
  explorerUrl?: string;
  fetch?: typeof fetch;
}

interface CoordinatorPayment {
  id?: string;
  paymentId?: string;
  status?: string;
  receipt?: { receiptHash?: Hex; signature?: Hex; adapter?: Address; txHash?: Hex; [k: string]: unknown } | null;
  attestations?: unknown[];
  decision?: { outcomeClass?: OutcomeClass; reason?: string } | null;
}

export class HspRail implements PaymentRail {
  readonly name = "hsp" as const;
  private adapter?: Address;
  private readonly f: typeof fetch;

  constructor(private readonly cfg: HspConfig) {
    this.f = cfg.fetch ?? ((...a) => fetch(...a));
    this.adapter = cfg.pinnedAdapter;
  }

  static fromEnv(): HspRail {
    const e = env();
    if (!e.HSP_COORDINATOR_URL || !e.HSP_API_KEY || !e.HSP_CHAIN) {
      throw new Error("HSP_MODE=live needs HSP_COORDINATOR_URL, HSP_API_KEY and HSP_CHAIN (see apps/api/HSP.md)");
    }
    return new HspRail({
      coordinatorUrl: e.HSP_COORDINATOR_URL.replace(/\/$/, ""),
      apiKey: e.HSP_API_KEY,
      chain: e.HSP_CHAIN,
      pinnedAdapter: e.HSP_ADAPTER_ADDRESS && isAddress(e.HSP_ADAPTER_ADDRESS) ? getAddress(e.HSP_ADAPTER_ADDRESS) : undefined,
      explorerUrl: e.HSP_EXPLORER_URL,
    });
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
    const res = await this.f(`${this.cfg.coordinatorUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(method !== "GET" ? { authorization: `Bearer ${this.cfg.apiKey}` } : {}),
      },
      body: body ? JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as T;
    if (res.status >= 500) throw new ApiError(502, "hsp_unavailable", `Coordinator ${method} ${path} → ${res.status}`);
    return { status: res.status, json };
  }

  /**
   * Pins the adapter's observation address from `GET /chains`. If HSP_ADAPTER_ADDRESS is set it
   * must match (out-of-band pin wins; a mismatch refuses to start).
   */
  async pinAdapter(): Promise<Address> {
    const { json } = await this.call<unknown>("GET", "/chains");
    const list = (Array.isArray(json) ? json : ((json as { chains?: unknown[] }).chains ?? [])) as {
      name?: string;
      id?: string;
      adapterAddress?: string;
      adapter?: string;
    }[];
    const entry = list.find((c) => c.name === this.cfg.chain || c.id === this.cfg.chain);
    const found = entry?.adapterAddress ?? entry?.adapter;
    if (!found || !isAddress(found)) throw new Error(`HSP chain ${this.cfg.chain} has no adapter address in /chains`);
    const a = getAddress(found);
    if (this.adapter && this.adapter !== a) {
      throw new Error(`HSP adapter mismatch: pinned ${this.adapter}, coordinator says ${a}`);
    }
    this.adapter = a;
    log.info({ adapter: a, chain: this.cfg.chain }, "HSP adapter pinned");
    return a;
  }

  explorerUrl(paymentId: string) {
    return `${this.cfg.explorerUrl ?? `${this.cfg.coordinatorUrl}/explorer`}/payments/${paymentId}`;
  }

  async createIntent(p: CreateIntentParams): Promise<Intent> {
    const payee = addr("PerformanceEscrow");
    const td = buildMandate(p, payee);
    const id = mandateHash(td);
    await db().insert(railPayments).values({ id, rail: this.name, mandateJson: td });
    return { intentId: id, mandateTypedData: td, payee, reference: td.message.reference };
  }

  async submit(p: { intentId: string; mandateSig?: Hex; txHash: Hex }) {
    if (!p.mandateSig) throw badRequest("bad_mandate_sig", "mandateSig required");
    const mandateSig = p.mandateSig;
    const row = await db().query.railPayments.findFirst({ where: eq(railPayments.id, p.intentId) });
    if (!row) throw notFound("Payment intent");
    const td = row.mandateJson as MandateTypedData;
    if (!(await checkMandateSig(td, mandateSig))) throw badRequest("bad_mandate_sig", "Mandate not signed by the payer");

    if (row.status === "CREATED") {
      const reg = await this.call<{ paymentId?: string; id?: string }>("POST", "/payments", {
        mandate: td,
        signature: mandateSig,
        attestations: [],
      });
      if (reg.status >= 400 && reg.status !== 409) {
        throw new ApiError(422, "hsp_register_failed", `Coordinator rejected the mandate (${reg.status})`);
      }
      const remoteId = reg.json.paymentId ?? reg.json.id;
      if (remoteId && remoteId.toLowerCase() !== row.id.toLowerCase()) {
        log.warn({ local: row.id, remote: remoteId }, "HSP paymentId differs from local mandate hash");
      }
    }
    const obs = await this.call("POST", `/payments/${row.id}/observe`, { txHash: p.txHash });
    if (obs.status >= 400) throw new ApiError(422, "hsp_observe_failed", `Coordinator refused observe (${obs.status})`);
    await db()
      .update(railPayments)
      .set({ mandateSig, txHash: p.txHash.toLowerCase(), status: "SUBMITTED", updatedAt: new Date() })
      .where(eq(railPayments.id, row.id));
    return { paymentId: row.id };
  }

  async verify(paymentId: string): Promise<Verification> {
    const row = await db().query.railPayments.findFirst({ where: eq(railPayments.id, paymentId) });
    if (!row) throw notFound("Payment");
    const td = row.mandateJson as MandateTypedData;
    const m = td.message;
    const zero = `0x${"00".repeat(32)}` as Hex;
    const base = {
      amount: BigInt(m.amount),
      payer: getAddress(m.payer),
      payee: getAddress(m.payee),
      token: getAddress(m.token),
      txHash: (row.txHash ?? "0x") as Hex,
      explorerUrl: this.explorerUrl(paymentId),
    };
    const adapter = this.adapter ?? (await this.pinAdapter());

    const { status, json } = await this.call<CoordinatorPayment>("GET", `/payments/${paymentId}`);
    if (status === 404) return { ...base, outcomeClass: "RETRYABLE", receiptHash: zero, reason: "unknown to coordinator yet" };
    const receipt = json.receipt;
    // The coordinator's own decision is informative only; anything but ACCEPT short-circuits.
    const claimed = json.decision?.outcomeClass;
    if (claimed && claimed !== "ACCEPT") {
      return { ...base, outcomeClass: claimed, receiptHash: zero, reason: json.decision?.reason ?? `coordinator: ${claimed}` };
    }
    if (!receipt?.receiptHash || !receipt.signature) {
      return { ...base, outcomeClass: "RETRYABLE", receiptHash: zero, reason: "no receipt yet" };
    }

    // 1. receipt signed by the pinned adapter
    const signer = await recoverAddress({ hash: receipt.receiptHash, signature: receipt.signature }).catch(() => null);
    if (!signer || getAddress(signer) !== adapter) {
      return { ...base, outcomeClass: "PERMANENT", receiptHash: receipt.receiptHash, reason: "receipt not signed by the pinned adapter" };
    }
    // 2. receipt is about our tx
    if (receipt.txHash && row.txHash && receipt.txHash.toLowerCase() !== row.txHash) {
      return { ...base, outcomeClass: "PERMANENT", receiptHash: receipt.receiptHash, reason: "receipt is for another transaction" };
    }
    // 3. required capabilities must be covered by attestations
    if (m.requiredCaps && !(json.attestations ?? []).length) {
      return { ...base, outcomeClass: "POLICY", receiptHash: receipt.receiptHash, reason: `unsatisfied: ${m.requiredCaps}` };
    }
    // 4. the settlement itself, observed on-chain by us
    const obs = await observeTransfer(base.txHash, { token: base.token, from: base.payer, to: base.payee, amount: base.amount });
    if (obs.outcomeClass !== "ACCEPT") {
      return { ...base, outcomeClass: obs.outcomeClass, receiptHash: receipt.receiptHash, reason: obs.reason };
    }
    await db()
      .update(railPayments)
      .set({
        outcomeClass: "ACCEPT",
        status: "VERIFIED",
        receiptJson: receipt,
        receiptHash: receipt.receiptHash,
        adapterSig: receipt.signature,
        updatedAt: new Date(),
      })
      .where(eq(railPayments.id, paymentId));
    return { ...base, outcomeClass: "ACCEPT", receiptHash: receipt.receiptHash };
  }
}
