import {
  ENCRYPTION_KEY_MESSAGE,
  decryptSignalBody,
  deriveEncryptionKey,
  unwrapKey,
  type EncryptionKeyPair,
} from "@nundina/shared";
import type { Address, Hex } from "viem";

/**
 * Buyer encryption key, derived from a wallet signature over `encKeyMessage(address)`. Lives in
 * memory and `sessionStorage` only; signing again re-derives the same key, so nothing is lost.
 */

export const encKeyMessage = (address: Address) => `${ENCRYPTION_KEY_MESSAGE}\n${address.toLowerCase()}`;

const storageKey = (address: Address) => `nundina:enc:${address.toLowerCase()}`;
const memory = new Map<string, EncryptionKeyPair>();

export function keyFromSignature(signature: Hex): EncryptionKeyPair {
  return deriveEncryptionKey(signature);
}

export function loadKey(address: Address): EncryptionKeyPair | null {
  const hit = memory.get(address.toLowerCase());
  if (hit) return hit;
  try {
    const raw = sessionStorage.getItem(storageKey(address));
    if (!raw) return null;
    const k = JSON.parse(raw) as EncryptionKeyPair;
    memory.set(address.toLowerCase(), k);
    return k;
  } catch {
    return null;
  }
}

export function storeKey(address: Address, k: EncryptionKeyPair) {
  memory.set(address.toLowerCase(), k);
  try {
    sessionStorage.setItem(storageKey(address), JSON.stringify(k));
  } catch {
    /* private mode: memory only */
  }
}

export function clearKey(address: Address) {
  memory.delete(address.toLowerCase());
  try {
    sessionStorage.removeItem(storageKey(address));
  } catch {
    /* ignore */
  }
}

export interface KeyDelivery {
  wrappedKey: string;
  ciphertext: string;
  iv: string;
}

/** Unwraps the per-signal AES key and decrypts the signal body, all on device. */
export function decryptDelivery<T = unknown>(privateKey: Hex, d: KeyDelivery): T {
  return decryptSignalBody<T>(unwrapKey(privateKey, d.wrappedKey), d.ciphertext, d.iv);
}
