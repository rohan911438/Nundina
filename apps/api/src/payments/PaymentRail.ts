import { encodeAbiParameters, hashTypedData, keccak256, type Address, type Hex } from "viem";

export type OutcomeClass = "ACCEPT" | "RETRYABLE" | "POLICY" | "PERMANENT";
export type Compliance = "kyc" | "sanctions";

/** EIP-712 typed data for a payer's HSP mandate. */
export interface MandateTypedData {
  domain: { name: string; version: string; chainId: number };
  types: typeof MANDATE_TYPES;
  primaryType: "Mandate";
  message: MandateMessage;
}

export interface MandateMessage {
  payer: Address;
  payee: Address;
  token: Address;
  amount: string;
  chainId: string;
  reference: Hex;
  /** Capabilities the payer requires, comma separated (e.g. "attests:kyc,attests:sanctions"). */
  requiredCaps: string;
  nonce: Hex;
  deadline: string;
}

export interface CreateIntentParams {
  signalId: bigint;
  payer: Address;
  token: Address;
  amount: bigint;
  compliance?: Compliance[];
}

export interface Intent {
  /** = paymentId = mandateHash. */
  intentId: string;
  mandateTypedData: MandateTypedData;
  payee: Address;
  reference: Hex;
}

export interface Verification {
  outcomeClass: OutcomeClass;
  receiptHash: Hex;
  amount: bigint;
  payer: Address;
  payee: Address;
  token: Address;
  txHash: Hex;
  explorerUrl?: string;
  /** Human-readable reason for anything but ACCEPT. */
  reason?: string;
}

export interface PaymentRail {
  readonly name: "mock" | "hsp";
  createIntent(p: CreateIntentParams): Promise<Intent>;
  submit(p: { intentId: string; mandateSig: Hex; txHash: Hex }): Promise<{ paymentId: string }>;
  verify(paymentId: string): Promise<Verification>;
}

// ───────────────────────── mandate encoding ─────────────────────────
// TODO(hsp-live): replace with the @hsp/sdk mandate builder once the SDK repo is shared; the
// shape below follows the developer guide (payer, payee, token, amount, chain, requirements).

export const MANDATE_TYPES = {
  Mandate: [
    { name: "payer", type: "address" },
    { name: "payee", type: "address" },
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "chainId", type: "uint256" },
    { name: "reference", type: "bytes32" },
    { name: "requiredCaps", type: "string" },
    { name: "nonce", type: "bytes32" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

export const MANDATE_TTL_S = 30 * 60;

/** `reference = keccak256(abi.encode(signalId, payer))` binds a payment to one purchase. */
export function purchaseReference(signalId: bigint, payer: Address): Hex {
  return keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }], [signalId, payer]));
}

export function capsFor(compliance?: Compliance[]): string {
  return (compliance ?? []).map((c) => `attests:${c}`).join(",");
}

export function mandateHash(td: MandateTypedData): Hex {
  return hashTypedData({
    domain: td.domain,
    types: td.types,
    primaryType: "Mandate",
    message: {
      ...td.message,
      amount: BigInt(td.message.amount),
      chainId: BigInt(td.message.chainId),
      deadline: BigInt(td.message.deadline),
    },
  });
}
