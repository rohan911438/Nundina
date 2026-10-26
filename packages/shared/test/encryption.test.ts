import { describe, expect, it } from "vitest";
import { gcm } from "@noble/ciphers/aes.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  ENCRYPTION_KEY_MESSAGE,
  decryptSignalBody,
  deriveEncryptionKey,
  generateEncryptionKey,
  isEncryptionPublicKey,
  unwrapKey,
  wrapKey,
} from "../src/encryption";

describe("encryption keys", () => {
  it("derives the same key from the same wallet signature", async () => {
    const wallet = privateKeyToAccount(generatePrivateKey());
    const sig = await wallet.signMessage({ message: ENCRYPTION_KEY_MESSAGE });
    const a = deriveEncryptionKey(sig);
    const b = deriveEncryptionKey(await wallet.signMessage({ message: ENCRYPTION_KEY_MESSAGE }));
    expect(a).toEqual(b);
    expect(isEncryptionPublicKey(a.publicKey)).toBe(true);
    expect(a.privateKey).not.toBe(generatePrivateKey());
  });

  it("wraps and unwraps a key, then decrypts a body", () => {
    const kp = generateEncryptionKey();
    const aesKey = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = gcm(aesKey, iv).encrypt(new TextEncoder().encode(JSON.stringify({ entry: "123" })));
    const wrapped = wrapKey(kp.publicKey, aesKey);
    const key = unwrapKey(kp.privateKey, wrapped);
    expect(decryptSignalBody(key, bytesToHex(ct), bytesToHex(iv))).toEqual({ entry: "123" });
    expect(() => unwrapKey(generateEncryptionKey().privateKey, wrapped)).toThrow();
  });

  it("rejects junk public keys", () => {
    expect(isEncryptionPublicKey("0x1234")).toBe(false);
  });
});
