import { gcm } from "@noble/ciphers/aes.js";
import { randomBytes } from "@noble/ciphers/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { hmac } from "@noble/hashes/hmac.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

/** AES-256-GCM encrypt; output = iv(12) || ciphertext+tag. */
export function aesEncrypt(key: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const iv = randomBytes(12);
  const ct = gcm(key, iv).encrypt(plaintext);
  const out = new Uint8Array(12 + ct.length);
  out.set(iv, 0);
  out.set(ct, 12);
  return out;
}

export function aesDecrypt(key: Uint8Array, sealed: Uint8Array): Uint8Array {
  return gcm(key, sealed.subarray(0, 12)).decrypt(sealed.subarray(12));
}

export function random32Hex(): `0x${string}` {
  return `0x${bytesToHex(randomBytes(32))}`;
}

export function sha256Hex(s: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(s)));
}

export function hmacSha256(key: Uint8Array | string, msg: string): Uint8Array {
  const k = typeof key === "string" ? new TextEncoder().encode(key) : key;
  return hmac(sha256, k, new TextEncoder().encode(msg));
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export { bytesToHex, hexToBytes, randomBytes };
