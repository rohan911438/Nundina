import { eq } from "drizzle-orm";
import { bytesToHex } from "@noble/hashes/utils.js";
import { deserializeSignal, serializeSignal, wrapKey, type Signal } from "@nundina/shared";
import { db } from "../db/client.js";
import { agents, keyDeliveries, purchases, signals, users } from "../db/schema.js";
import { ApiError, notFound } from "../lib/errors.js";
import { aesDecrypt, aesEncrypt, randomBytes } from "../lib/crypto.js";
import { seal, unseal, unsealHex } from "./masterKey.js";

/** What the key service stores for a freshly committed signal. */
export interface EncryptedSignal {
  /** iv(12) || AES-256-GCM ciphertext+tag of JSON(signal without salt). */
  ciphertext: Uint8Array;
  /** Per-signal AES key, sealed with the master key. */
  aesKeyEnc: Uint8Array;
}

type Body = Omit<ReturnType<typeof serializeSignal>, "salt">;

/** Fresh random AES key per signal; the body never includes the salt. */
export function encryptSignal(signal: Signal): EncryptedSignal {
  const key = randomBytes(32);
  const { salt: _salt, ...body } = serializeSignal(signal);
  const pt = new TextEncoder().encode(JSON.stringify(body));
  return { ciphertext: aesEncrypt(key, pt), aesKeyEnc: seal(key) };
}

/** Server-side decryption (reveal material, tests). */
export function decryptSignal(enc: EncryptedSignal): Body {
  const key = unseal(enc.aesKeyEnc);
  return JSON.parse(new TextDecoder().decode(aesDecrypt(key, enc.ciphertext))) as Body;
}

/** Splits stored ciphertext into the `{ ciphertext, iv }` pair buyers get. */
export function splitCiphertext(c: Uint8Array) {
  return { iv: `0x${bytesToHex(c.subarray(0, 12))}`, ciphertext: `0x${bytesToHex(c.subarray(12))}` };
}

/**
 * ECIES-wraps the signal's AES key to the buyer's registered encryption public key and stores
 * the delivery. Idempotent per purchase.
 */
export async function wrapKeyFor(purchaseId: string, channel: "web" | "telegram" | "api" = "web") {
  const existing = await db().query.keyDeliveries.findFirst({ where: eq(keyDeliveries.purchaseId, purchaseId) });
  if (existing) return existing;
  const p = await db().query.purchases.findFirst({ where: eq(purchases.id, purchaseId) });
  if (!p) throw notFound("Purchase");
  // agent purchases are wrapped to the agent's own key, so the agent process can decrypt them
  const agent = p.agentId ? await db().query.agents.findFirst({ where: eq(agents.id, p.agentId) }) : undefined;
  const buyer = p.buyerUserId ? await db().query.users.findFirst({ where: eq(users.id, p.buyerUserId) }) : undefined;
  const pubkey = agent?.encPubkey ?? buyer?.pubkey;
  if (!pubkey) throw new ApiError(409, "no_encryption_key", "Buyer has no registered encryption key");
  const s = await db().query.signals.findFirst({ where: eq(signals.id, p.signalId) });
  if (!s?.aesKeyEnc) throw new ApiError(409, "no_key_material", "This signal can't be unlocked: its key was not saved when it was locked. Pick another signal; the provider can post it again.");

  const wrapped = wrapKey(pubkey, unseal(s.aesKeyEnc));
  const [row] = await db()
    .insert(keyDeliveries)
    .values({ purchaseId, wrappedKey: wrapped, channel, deliveredAt: new Date() })
    .onConflictDoNothing()
    .returning();
  return row ?? (await db().query.keyDeliveries.findFirst({ where: eq(keyDeliveries.purchaseId, purchaseId) }))!;
}

/** Plaintext + salt for SignalBook.reveal / resolver calls. Internal callers only. */
export async function revealMaterial(signalId: bigint): Promise<Signal> {
  const s = await db().query.signals.findFirst({ where: eq(signals.id, signalId) });
  if (!s?.ciphertext || !s.aesKeyEnc || !s.saltEnc) throw notFound("Reveal material");
  const body = decryptSignal({ ciphertext: s.ciphertext, aesKeyEnc: s.aesKeyEnc });
  return deserializeSignal({ ...body, salt: unsealHex(s.saltEnc) });
}
