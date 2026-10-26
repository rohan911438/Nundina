import { serializeSignal, type Signal } from "@nundina/shared";
import { aesDecrypt, aesEncrypt, randomBytes, seal, unseal } from "../lib/crypto.js";

/** What the key service returns for a freshly committed signal. */
export interface EncryptedSignal {
  ciphertext: Uint8Array;
  /** Per-signal AES key, sealed with the master key. */
  aesKeyEnc: Uint8Array;
}

/**
 * Encrypts the plaintext signal body with a fresh per-signal AES-256-GCM key.
 * The key is sealed at rest with the master key. Prompt 07 adds ECIES wrapping per buyer.
 */
export function encryptSignal(signal: Signal): EncryptedSignal {
  const key = randomBytes(32);
  const body = new TextEncoder().encode(JSON.stringify(serializeSignal(signal)));
  return { ciphertext: aesEncrypt(key, body), aesKeyEnc: seal(key) };
}

/** Inverse of `encryptSignal`; server-side only (reveal, tests). */
export function decryptSignal(enc: EncryptedSignal): ReturnType<typeof serializeSignal> {
  const key = unseal(enc.aesKeyEnc);
  return JSON.parse(new TextDecoder().decode(aesDecrypt(key, enc.ciphertext)));
}
