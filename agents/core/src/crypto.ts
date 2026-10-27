import { decryptSignalBody, fromPrice, marketById, unwrapKey } from "@nundina/shared";
import type { Nundina } from "./nundina.js";

/** Decrypted signal body as the API encrypts it (serialized Signal without the salt). */
export interface SignalBody {
  market: `0x${string}`;
  side: number;
  entry: string;
  takeProfit: string;
  stopLoss: string;
  validUntil: string;
  pricePerSub: string;
  upstream: string[];
  upstreamBps: number[];
}

export interface Plain {
  signalId: string;
  market: string;
  side: "LONG" | "SHORT";
  entry: number;
  takeProfit: number;
  stopLoss: number;
  validUntil: number;
}

export function toPlain(signalId: string, b: SignalBody): Plain {
  return {
    signalId,
    market: marketById(b.market)?.label ?? b.market,
    side: b.side === 0 ? "LONG" : "SHORT",
    entry: Number(fromPrice(BigInt(b.entry))),
    takeProfit: Number(fromPrice(BigInt(b.takeProfit))),
    stopLoss: Number(fromPrice(BigInt(b.stopLoss))),
    validUntil: Number(b.validUntil),
  };
}

/** Unwraps the delivered key with the agent's encryption key (never leaves the process) and decrypts. */
export async function decryptPurchase(api: Nundina, encKey: string, purchaseId: string): Promise<Plain> {
  const d = await api.key(purchaseId);
  const body = decryptSignalBody<SignalBody>(unwrapKey(encKey, d.wrappedKey), d.ciphertext, d.iv);
  return toPlain(d.signalId, body);
}
