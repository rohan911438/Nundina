import { gcm } from "@noble/ciphers/aes.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { PrivateKey, PublicKey, decrypt, encrypt } from "eciesjs";
import type { Hex } from "viem";

/**
 * Buyer encryption keys. Users never use their wallet key for decryption: the web app asks the
 * wallet to sign ENCRYPTION_KEY_MESSAGE and derives a dedicated secp256k1 key from the signature
 * (deterministic, so the same wallet always gets the same key). Only the public key leaves the browser.
 */
export const ENCRYPTION_KEY_MESSAGE = "Nundina encryption key v1";

const strip = (h: string) => (h.startsWith("0x") ? h.slice(2) : h);
const toHex = (b: Uint8Array) => `0x${bytesToHex(b)}` as Hex;

export interface EncryptionKeyPair {
  privateKey: Hex;
  /** Compressed secp256k1 public key (33 bytes). */
  publicKey: Hex;
}

/** HKDF-SHA256(signature) → secp256k1 private key. Re-derives with a counter in the (negligible) invalid case. */
export function deriveEncryptionKey(signature: Hex): EncryptionKeyPair {
  const ikm = hexToBytes(strip(signature));
  for (let i = 0; i < 16; i++) {
    const sk = hkdf(sha256, ikm, new TextEncoder().encode("nundina"), new TextEncoder().encode(`ecies-secp256k1/${i}`), 32);
    try {
      const k = new PrivateKey(sk);
      return { privateKey: toHex(k.secret), publicKey: `0x${k.publicKey.toHex(true)}` as Hex };
    } catch {
      /* out of range, try the next counter */
    }
  }
  throw new Error("could not derive encryption key");
}

/** Random key pair (agents). */
export function generateEncryptionKey(): EncryptionKeyPair {
  const k = new PrivateKey();
  return { privateKey: toHex(k.secret), publicKey: `0x${k.publicKey.toHex(true)}` as Hex };
}

/** True if `hex` is a valid secp256k1 public key (compressed or uncompressed). */
export function isEncryptionPublicKey(hex: string): boolean {
  try {
    PublicKey.fromHex(strip(hex));
    return true;
  } catch {
    return false;
  }
}

/** ECIES-wraps a per-signal AES key to a buyer's public key. */
export function wrapKey(publicKey: string, aesKey: Uint8Array): Hex {
  return toHex(encrypt(strip(publicKey), aesKey));
}

export function unwrapKey(privateKey: string, wrapped: string): Uint8Array {
  return decrypt(strip(privateKey), hexToBytes(strip(wrapped)));
}

/** Decrypts a signal body (AES-256-GCM, 12-byte iv) with the unwrapped key. Returns the parsed JSON. */
export function decryptSignalBody<T = unknown>(aesKey: Uint8Array, ciphertext: string, iv: string): T {
  const pt = gcm(aesKey, hexToBytes(strip(iv))).decrypt(hexToBytes(strip(ciphertext)));
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}
