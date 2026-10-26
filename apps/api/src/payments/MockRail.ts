import { eq } from "drizzle-orm";
import {
  encodeAbiParameters,
  getAddress,
  keccak256,
  recoverAddress,
  recoverTypedDataAddress,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainById } from "@nundina/shared";
import { db } from "../db/client.js";
import { railPayments } from "../db/schema.js";
import { env } from "../env.js";
import { addr } from "../chain/clients.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { random32Hex } from "../lib/crypto.js";
import { observeTransfer } from "./observe.js";
import {
  MANDATE_TTL_S,
  MANDATE_TYPES,
  capsFor,
  mandateHash,
  purchaseReference,
  type CreateIntentParams,
  type Intent,
  type MandateTypedData,
  type PaymentRail,
  type Verification,
} from "./PaymentRail.js";

/** Mock adapter key: env, else derived from INTERNAL_SECRET so it is stable per deployment. */
export function mockAdapter() {
  const pk = (env().MOCK_ADAPTER_PRIVATE_KEY ?? keccak256(toHex(`nundina-mock-adapter:${env().INTERNAL_SECRET}`))) as Hex;
  return privateKeyToAccount(pk);
}

/** Canonical receipt hash: what the adapter signs and what the escrow stores as single-use. */
export function receiptHashOf(r: {
  paymentId: Hex;
  txHash: Hex;
  chainId: number;
  token: Address;
  from: Address;
  to: Address;
  amount: bigint;
  logIndex: number;
}): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      [r.paymentId, r.txHash, BigInt(r.chainId), r.token, r.from, r.to, r.amount, BigInt(r.logIndex)],
    ),
  );
}

export function explorerTxUrl(txHash: string): string | undefined {
  const base = chainById(env().CHAIN_ID).blockExplorers?.default.url;
  return base ? `${base}/tx/${txHash}` : undefined;
}

export function buildMandate(p: CreateIntentParams, payee: Address): MandateTypedData {
  const chainId = env().CHAIN_ID;
  return {
    domain: { name: "HSP", version: "1", chainId },
    types: MANDATE_TYPES,
    primaryType: "Mandate",
    message: {
      payer: getAddress(p.payer),
      payee,
      token: getAddress(p.token),
      amount: p.amount.toString(),
      chainId: String(chainId),
      reference: purchaseReference(p.signalId, getAddress(p.payer)),
      requiredCaps: capsFor(p.compliance),
      nonce: random32Hex(),
      deadline: String(Math.floor(Date.now() / 1000) + MANDATE_TTL_S),
    },
  };
}

export async function checkMandateSig(td: MandateTypedData, sig: Hex): Promise<boolean> {
  const signer = await recoverTypedDataAddress({
    domain: td.domain,
    types: td.types,
    primaryType: "Mandate",
    message: {
      ...td.message,
      amount: BigInt(td.message.amount),
      chainId: BigInt(td.message.chainId),
      deadline: BigInt(td.message.deadline),
    },
    signature: sig,
  }).catch(() => null);
  return signer != null && getAddress(signer) === getAddress(td.message.payer);
}

/**
 * Fake Coordinator with the same shapes as HSP: mandates in Postgres, settlement observed on-chain,
 * receipts signed by a local adapter key and verified against the pinned adapter address.
 */
export class MockRail implements PaymentRail {
  readonly name = "mock" as const;

  async createIntent(p: CreateIntentParams): Promise<Intent> {
    const payee = addr("PerformanceEscrow");
    const td = buildMandate(p, payee);
    const id = mandateHash(td);
    await db().insert(railPayments).values({ id, rail: this.name, mandateJson: td });
    return { intentId: id, mandateTypedData: td, payee, reference: td.message.reference };
  }

  async submit(p: { intentId: string; mandateSig: Hex; txHash: Hex }) {
    const row = await db().query.railPayments.findFirst({ where: eq(railPayments.id, p.intentId) });
    if (!row) throw notFound("Payment intent");
    if (row.txHash && row.txHash !== p.txHash.toLowerCase()) throw conflict("already_submitted", "Intent already has a transaction");
    const td = row.mandateJson as MandateTypedData;
    if (!(await checkMandateSig(td, p.mandateSig))) throw badRequest("bad_mandate_sig", "Mandate not signed by the payer");
    const used = await db().query.railPayments.findFirst({ where: eq(railPayments.txHash, p.txHash.toLowerCase()) });
    if (used && used.id !== row.id) throw conflict("tx_reused", "Transaction already used for another payment");
    await db()
      .update(railPayments)
      .set({ mandateSig: p.mandateSig, txHash: p.txHash.toLowerCase(), status: "SUBMITTED", updatedAt: new Date() })
      .where(eq(railPayments.id, row.id));
    return { paymentId: row.id };
  }

  async verify(paymentId: string): Promise<Verification> {
    const row = await db().query.railPayments.findFirst({ where: eq(railPayments.id, paymentId) });
    if (!row) throw notFound("Payment");
    const td = row.mandateJson as MandateTypedData;
    const m = td.message;
    const base = {
      amount: BigInt(m.amount),
      payer: getAddress(m.payer),
      payee: getAddress(m.payee),
      token: getAddress(m.token),
      txHash: (row.txHash ?? "0x") as Hex,
      explorerUrl: row.txHash ? explorerTxUrl(row.txHash) : undefined,
    };
    const zero = `0x${"00".repeat(32)}` as Hex;
    if (!row.txHash || !row.mandateSig) return { ...base, outcomeClass: "RETRYABLE", receiptHash: zero, reason: "not submitted" };
    if (!(await checkMandateSig(td, row.mandateSig as Hex))) {
      return { ...base, outcomeClass: "PERMANENT", receiptHash: zero, reason: "bad mandate signature" };
    }
    if (m.requiredCaps) {
      // The mock has no attestation issuer; compliant mandates can never be satisfied here.
      return { ...base, outcomeClass: "POLICY", receiptHash: zero, reason: `unsatisfied capabilities: ${m.requiredCaps}` };
    }

    const obs = await observeTransfer(row.txHash as Hex, { token: base.token, from: base.payer, to: base.payee, amount: base.amount });
    if (obs.outcomeClass !== "ACCEPT") {
      await this.record(paymentId, obs.outcomeClass, null, null, null);
      return { ...base, outcomeClass: obs.outcomeClass, receiptHash: zero, reason: obs.reason };
    }

    const receipt = {
      paymentId: paymentId as Hex,
      txHash: row.txHash as Hex,
      chainId: env().CHAIN_ID,
      token: base.token,
      from: base.payer,
      to: base.payee,
      amount: base.amount,
      logIndex: obs.logIndex!,
    };
    const receiptHash = receiptHashOf(receipt);
    const adapter = mockAdapter();
    const adapterSig = await adapter.sign({ hash: receiptHash });
    // verify like a relying party would: the receipt must be signed by the pinned adapter
    const signer = await recoverAddress({ hash: receiptHash, signature: adapterSig });
    if (getAddress(signer) !== adapter.address) {
      return { ...base, outcomeClass: "PERMANENT", receiptHash, reason: "receipt not signed by pinned adapter" };
    }
    await this.record(paymentId, "ACCEPT", { ...receipt, amount: receipt.amount.toString() }, receiptHash, adapterSig);
    return { ...base, outcomeClass: "ACCEPT", receiptHash };
  }

  private async record(id: string, outcome: string, receipt: object | null, receiptHash: Hex | null, sig: Hex | null) {
    await db()
      .update(railPayments)
      .set({
        outcomeClass: outcome,
        status: outcome === "ACCEPT" ? "VERIFIED" : outcome === "RETRYABLE" ? "SUBMITTED" : "REJECTED",
        receiptJson: receipt,
        receiptHash,
        adapterSig: sig,
        updatedAt: new Date(),
      })
      .where(eq(railPayments.id, id));
  }
}
