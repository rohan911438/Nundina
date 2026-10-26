import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { apiKeys } from "../db/schema.js";
import { bytesToHex, randomBytes, sha256Hex } from "../lib/crypto.js";

const PREFIX = "nk_";

/** Creates an API key; returns the plaintext once (only the sha256 is stored). */
export async function createApiKey(opts: { ownerUserId?: number; agentId?: number; label?: string }) {
  const key = `${PREFIX}${bytesToHex(randomBytes(24))}`;
  await db()
    .insert(apiKeys)
    .values({ keyHash: sha256Hex(key), prefix: key.slice(0, 10), ...opts });
  return key;
}

export async function resolveApiKey(key: string) {
  if (!key.startsWith(PREFIX)) return undefined;
  return db().query.apiKeys.findFirst({
    where: and(eq(apiKeys.keyHash, sha256Hex(key)), isNull(apiKeys.revokedAt)),
  });
}
