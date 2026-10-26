import { Hono } from "hono";
import { and, asc, eq, isNotNull, notInArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { signals } from "../db/schema.js";
import { requireInternal, type AppEnv } from "../auth/context.js";

/** Statuses after which the keeper has nothing left to do. */
const DONE = ["SETTLED", "REFUNDED"];

/**
 * Internal routes for the keeper. The DB only enumerates candidates; the keeper reads the real
 * state of each signal from the chain before acting.
 */
export const keeperRoutes = new Hono<AppEnv>()
  .use("/internal/keeper/*", requireInternal)
  .get("/internal/keeper/signals", async (c) => {
    const rows = await db()
      .select({
        id: signals.id,
        market: signals.market,
        marketId: signals.marketId,
        status: signals.status,
        validUntil: signals.validUntil,
        committedAt: signals.committedAt,
        hasMaterial: isNotNull(signals.ciphertext),
      })
      .from(signals)
      .where(and(eq(signals.source, "chain"), notInArray(signals.status, DONE)))
      .orderBy(asc(signals.id))
      .limit(1000);
    return c.json({
      items: rows.map((r) => ({
        ...r,
        id: r.id.toString(),
        validUntil: Math.floor(r.validUntil.getTime() / 1000),
        committedAt: Math.floor(r.committedAt.getTime() / 1000),
      })),
    });
  });
