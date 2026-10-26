import { Hono } from "hono";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { providers, purchases, settlements, signalDrafts, signals, users } from "../db/schema.js";
import { requireInternal, type AppEnv } from "../auth/context.js";
import { userIdForTelegram } from "../auth/internal.js";
import { badRequest, notFound } from "../lib/errors.js";
import { publicProvider, publicSignal } from "../lib/serialize.js";

/** Purchases that paid (buyers get the unlock DM and the result DM). */
const PAID = ["CREDITED", "KEY_SENT", "SETTLED_WIN", "REFUNDED"];

async function telegramIdOfUser(userId: number | null) {
  if (!userId) return null;
  const u = await db().query.users.findFirst({ where: eq(users.id, userId) });
  return u?.telegramId ?? null;
}

async function providerCard(providerId: number) {
  const p = await db().query.providers.findFirst({ where: eq(providers.id, providerId) });
  if (!p) throw notFound("Provider");
  return { ...publicProvider(p), id: p.id, channelId: p.channelId, telegramId: await telegramIdOfUser(p.userId) };
}

/**
 * Internal routes for the Telegram bot. Everything the bot needs to render cards and route DMs,
 * so the bot never touches the database directly.
 */
export const telegramRoutes = new Hono<AppEnv>()
  .use("/internal/telegram/*", requireInternal)
  /** Telegram account → user id (creates the user on first contact). */
  .post("/internal/telegram/users", async (c) => {
    const b = z.object({ telegramId: z.number().int(), username: z.string().optional() }).safeParse(await c.req.json().catch(() => ({})));
    if (!b.success) throw badRequest("bad_body", "telegramId required");
    const userId = await userIdForTelegram(b.data.telegramId, b.data.username);
    const u = await db().query.users.findFirst({ where: eq(users.id, userId) });
    const p = await db().query.providers.findFirst({ where: eq(providers.userId, userId) });
    return c.json({ userId, wallet: u?.wallet ?? null, hasEncryptionKey: Boolean(u?.pubkey), provider: p ? { handle: p.handle, channelId: p.channelId } : null });
  })
  /** The provider whose linked channel this is (the bot ignores channels without one). */
  .get("/internal/telegram/channels/:chatId", async (c) => {
    const p = await db().query.providers.findFirst({ where: eq(providers.channelId, Number(c.req.param("chatId"))) });
    if (!p) throw notFound("Linked channel");
    return c.json(await providerCard(p.id));
  })
  /** The draft (and signal, once committed) created from a channel post. */
  .get("/internal/telegram/posts/:chatId/:messageId", async (c) => {
    const d = await db().query.signalDrafts.findFirst({
      where: and(eq(signalDrafts.sourceChatId, Number(c.req.param("chatId"))), eq(signalDrafts.sourceMessageId, Number(c.req.param("messageId")))),
      orderBy: desc(signalDrafts.id),
    });
    if (!d) throw notFound("Draft");
    return c.json({ draftId: d.id, status: d.status, signalId: d.signalId?.toString() ?? null });
  })
  .post("/internal/telegram/drafts/:id/ignore", async (c) => {
    const [d] = await db()
      .update(signalDrafts)
      .set({ status: "rejected", error: "ignored by provider", updatedAt: new Date() })
      .where(and(eq(signalDrafts.id, Number(c.req.param("id"))), inArray(signalDrafts.status, ["pending", "prepared"])))
      .returning();
    if (!d) throw notFound("Open draft");
    return c.json({ draftId: d.id, status: d.status });
  })
  /** Everything a locked / result card needs, plus who to notify. */
  .get("/internal/telegram/signals/:id", async (c) => {
    const id = BigInt(c.req.param("id"));
    const s = await db().query.signals.findFirst({ where: eq(signals.id, id) });
    if (!s) throw notFound("Signal");
    const provider = await providerCard(s.providerId);
    const buyers = await db()
      .select({ purchaseId: purchases.id, status: purchases.status, telegramId: users.telegramId })
      .from(purchases)
      .innerJoin(users, eq(users.id, purchases.buyerUserId))
      .where(and(eq(purchases.signalId, id), inArray(purchases.status, PAID), isNotNull(users.telegramId)));
    const st = await db().query.settlements.findFirst({ where: eq(settlements.signalId, id) });
    return c.json({
      signal: { ...publicSignal(s, provider), pricePerSub: s.price },
      provider,
      post: s.tgChatId && s.tgMessageId ? { chatId: s.tgChatId, messageId: s.tgMessageId } : null,
      cardMessageId: s.tgCardMessageId,
      buyers,
      settlement: st ? { outcome: st.outcome, payout: st.payout, refundsTotal: st.refundsTotal, slashTotal: st.slashTotal, settleTx: st.settleTx } : null,
    });
  })
  /** Records the locked card's message id so result cards can reply under it. */
  .post("/internal/telegram/signals/:id/card", async (c) => {
    const b = z.object({ messageId: z.number().int() }).safeParse(await c.req.json().catch(() => ({})));
    if (!b.success) throw badRequest("bad_body", "messageId required");
    await db().update(signals).set({ tgCardMessageId: b.data.messageId }).where(eq(signals.id, BigInt(c.req.param("id"))));
    return c.json({ ok: true });
  })
  /** Buyer and signal for an unlock DM. */
  .get("/internal/telegram/purchases/:id", async (c) => {
    const p = await db().query.purchases.findFirst({ where: eq(purchases.id, c.req.param("id")) });
    if (!p) throw notFound("Purchase");
    const s = await db().query.signals.findFirst({ where: eq(signals.id, p.signalId) });
    const prov = s ? await db().query.providers.findFirst({ where: eq(providers.id, s.providerId) }) : null;
    return c.json({
      purchaseId: p.id,
      status: p.status,
      telegramId: await telegramIdOfUser(p.buyerUserId),
      signal: s ? publicSignal(s, prov) : null,
    });
  });
