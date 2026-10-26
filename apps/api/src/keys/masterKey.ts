import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { env } from "../env.js";
import { aesDecrypt, aesEncrypt } from "../lib/crypto.js";

/**
 * Envelope encryption at rest for per-signal AES keys and salts.
 * Sealed format: keyId(4) || iv(12) || ciphertext+tag, keyId = sha256(masterKey)[0..4].
 * Rotation: set the new key in KEY_SERVICE_MASTER_KEY and the old one in
 * KEY_SERVICE_MASTER_KEY_PREVIOUS; old rows still open, new rows use the new key.
 */
const KEY_ID_LEN = 4;

interface MasterKey {
  id: string;
  key: Uint8Array;
}

function load(hex: string): MasterKey {
  const key = hexToBytes(hex);
  return { id: bytesToHex(sha256(key).subarray(0, KEY_ID_LEN)), key };
}

function current(): MasterKey {
  return load(env().KEY_SERVICE_MASTER_KEY);
}

function all(): MasterKey[] {
  const prev = env().KEY_SERVICE_MASTER_KEY_PREVIOUS;
  return prev ? [current(), load(prev)] : [current()];
}

export function seal(plaintext: Uint8Array): Uint8Array {
  const mk = current();
  const body = aesEncrypt(mk.key, plaintext);
  const out = new Uint8Array(KEY_ID_LEN + body.length);
  out.set(hexToBytes(mk.id), 0);
  out.set(body, KEY_ID_LEN);
  return out;
}

export function unseal(sealed: Uint8Array): Uint8Array {
  const id = bytesToHex(sealed.subarray(0, KEY_ID_LEN));
  const mk = all().find((k) => k.id === id);
  if (!mk) throw new Error(`no master key for key id ${id}`);
  return aesDecrypt(mk.key, sealed.subarray(KEY_ID_LEN));
}

export const sealHex = (hex: `0x${string}`) => seal(hexToBytes(hex.slice(2)));
export const unsealHex = (b: Uint8Array) => `0x${bytesToHex(unseal(b))}` as `0x${string}`;

/** Key id of the active master key (shown in /health, never the key). */
export const activeKeyId = () => current().id;
