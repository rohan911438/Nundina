import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { providers } from "../db/schema.js";

/**
 * The provider row of a user. A wallet that registered on-chain without the app (or before this
 * database existed) has a row the indexer made from chain events, with no user: the user signed in
 * with that wallet, which proves ownership, so the row is claimed here.
 */
export async function providerOfUser(userId: number, wallet?: string | null) {
  const p = await db().query.providers.findFirst({ where: eq(providers.userId, userId) });
  if (p || !wallet) return p ?? null;
  const [claimed] = await db()
    .update(providers)
    .set({ userId })
    .where(and(eq(providers.address, wallet.toLowerCase()), isNull(providers.userId)))
    .returning();
  return claimed ?? null;
}
