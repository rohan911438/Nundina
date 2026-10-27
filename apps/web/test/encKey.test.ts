// @vitest-environment node
// crypto runs in node: jsdom's TextEncoder returns a foreign-realm Uint8Array that noble rejects
import { describe, expect, it } from "vitest";
import { gcm } from "@noble/ciphers/aes.js";
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { wrapKey } from "@nundina/shared/encryption";
import { decryptDelivery, encKeyMessage, keyFromSignature, loadKey, storeKey, clearKey } from "@/lib/crypto/encKey";
import { toSignalInput, validateFields } from "@/components/flows/ConfirmSignal";
import { policyErrors, DEFAULT_POLICY } from "@/components/flows/AgentPolicyForm";
import { webEquivalent } from "@/components/tg/TgShell";

const hex = (b: Uint8Array) => `0x${bytesToHex(b)}`;

/** Same layout as the API key service: iv(12) || AES-256-GCM(ciphertext+tag), split for buyers. */
function apiEncrypt(body: unknown) {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const ct = gcm(key, iv).encrypt(new TextEncoder().encode(JSON.stringify(body)));
  return { key, iv: hex(iv), ciphertext: hex(ct) };
}

describe("encryption key", () => {
  it("is deterministic per wallet and differs across wallets", async () => {
    const a = privateKeyToAccount(generatePrivateKey());
    const b = privateKeyToAccount(generatePrivateKey());
    const k1 = keyFromSignature(await a.signMessage({ message: encKeyMessage(a.address) }));
    const k2 = keyFromSignature(await a.signMessage({ message: encKeyMessage(a.address) }));
    const kb = keyFromSignature(await b.signMessage({ message: encKeyMessage(b.address) }));
    expect(k1).toEqual(k2);
    expect(kb.publicKey).not.toBe(k1.publicKey);
    expect(encKeyMessage(a.address)).toBe(`Nundina encryption key v1\n${a.address.toLowerCase()}`);
  });

  it("decrypts a delivery made the way the API makes it", async () => {
    const a = privateKeyToAccount(generatePrivateKey());
    const k = keyFromSignature(await a.signMessage({ message: encKeyMessage(a.address) }));
    const body = { market: "0xabc", side: 0, entry: "8150000000000", takeProfit: "8300000000000", stopLoss: "8050000000000", validUntil: "1800000000" };
    const enc = apiEncrypt(body);
    const delivery = { wrappedKey: wrapKey(k.publicKey, enc.key), ciphertext: enc.ciphertext, iv: enc.iv };
    expect(decryptDelivery(k.privateKey, delivery)).toEqual(body);

    const other = keyFromSignature(await a.signMessage({ message: "something else" }));
    expect(() => decryptDelivery(other.privateKey, delivery)).toThrow();
  });

  it("stores the key per address in sessionStorage and clears it", async () => {
    const a = privateKeyToAccount(generatePrivateKey());
    const k = keyFromSignature(await a.signMessage({ message: encKeyMessage(a.address) }));
    storeKey(a.address, k);
    expect(loadKey(a.address)).toEqual(k);
    clearKey(a.address);
    expect(loadKey(a.address)).toBeNull();
  });
});

describe("confirm signal fields", () => {
  const provider = "0x000000000000000000000000000000000000dEaD";
  const ok = { market: "BTC/USD", side: "LONG" as const, entry: "81500", takeProfit: "83000", stopLoss: "80500", validHours: "24", priceUsd: "0.5" };

  it("converts to the API's units", () => {
    const i = toSignalInput(ok, 1_000);
    expect(i).toMatchObject({ entry: "8150000000000", takeProfit: "8300000000000", stopLoss: "8050000000000", validUntil: String(1_000 + 86_400), pricePerSub: "500000" });
  });

  it("validates with the shared rules", () => {
    expect(validateFields(ok, provider)).toEqual({});
    expect(validateFields({ ...ok, takeProfit: "80000" }, provider).entry).toMatch(/LONG requires/);
    expect(validateFields({ ...ok, takeProfit: "82000" }, provider).takeProfit).toMatch(/1:1/);
    expect(validateFields({ ...ok, validHours: "0.1" }, provider).validHours).toMatch(/15 minutes/);
    expect(validateFields({ ...ok, entry: "abc" }, provider).entry).toBe("Enter a number");
  });
});

describe("agent policy", () => {
  it("rejects a per-signal cap above the daily budget and empty markets", () => {
    expect(policyErrors(DEFAULT_POLICY)).toEqual({});
    expect(policyErrors({ ...DEFAULT_POLICY, maxPerSignalUsd: "9" }).maxPerSignalUsd).toMatch(/daily budget/);
    expect(policyErrors({ ...DEFAULT_POLICY, markets: [] }).markets).toBeDefined();
  });
});

describe("Mini App outside Telegram", () => {
  it("maps screens to their web pages", () => {
    expect(webEquivalent("/tg/buy/42")).toBe("/s/42");
    expect(webEquivalent("/tg/my")).toBe("/dashboard");
    expect(webEquivalent("/tg/connect")).toBe("/start");
    expect(webEquivalent("/tg/confirm/7")).toBeNull();
  });
});
