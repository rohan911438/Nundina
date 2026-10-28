import { Hono } from "hono";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { providers, purchases, settlements, signalDrafts, signals, users } from "../db/schema.js";
import { requireInternal, type AppEnv } from "../auth/context.js";
import { userIdForTelegram } from "../auth/internal.js";
import { badRequest, notFound } from "../lib/errors.js";
import { publicProvider, publicSignal } from "../lib/serialize.js";
import { linkedChannels, providerOfTelegram, unverifyChannel, verifyChannel } from "../services/channelVerify.js";
import { providerOfUser } from "../services/providerOfUser.js";
import { redeemInBot, startLinkFromBot } from "../services/telegramAccount.js";
import { ChannelFactsBody } from "./providers.js";

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
    const p = await providerOfUser(userId, u?.wallet);
    return c.json({ userId, wallet: u?.wallet ?? null, hasEncryptionKey: Boolean(u?.pubkey), provider: p ? { handle: p.handle, channelId: p.channelId } : null });
  })
  /** `/start acct_<token>`: the web asked to link this Telegram account to its wallet. */
  .post("/internal/telegram/account-links/redeem", async (c) => {
    const b = z
      .object({ token: z.string().min(8), telegramId: z.number().int(), username: z.string().nullish() })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!b.success) throw badRequest("bad_body", "token and telegramId required");
    return c.json(await redeemInBot(b.data.token, b.data.telegramId, b.data.username));
  })
  /** `/connect` in the bot: a token for a web link that a signed-in wallet redeems. */
  .post("/internal/telegram/account-links", async (c) => {
    const b = z.object({ telegramId: z.number().int(), username: z.string().nullish() }).safeParse(await c.req.json().catch(() => ({})));
    if (!b.success) throw badRequest("bad_body", "telegramId required");
    return c.json(await startLinkFromBot(b.data.telegramId, b.data.username));
  })
  /**
   * The bot was made admin of a channel by `telegramId`: link it to that person's provider profile
   * if Telegram's admin list says they own or admin it (re-checks refresh it the same way).
   */
  .post("/internal/telegram/channels/verify", async (c) => {
    const b = ChannelFactsBody.extend({ telegramId: z.number().int() }).safeParse(await c.req.json().catch(() => ({})));
    if (!b.success) throw badRequest("bad_body", b.error.issues.map((i) => i.message).join("; "));
    const { telegramId, ...facts } = b.data;
    const p = await providerOfTelegram(telegramId);
    if (!p) throw notFound("Provider profile for this Telegram account");
    const r = await verifyChannel(p.id, facts);
    return c.json({ provider: publicProvider(r.provider), role: r.role, lookalikeOf: r.lookalikeOf, telegramId: r.telegramId });
  })
  .post("/internal/telegram/channels/:chatId/unverify", async (c) => {
    const r = await unverifyChannel(Number(c.req.param("chatId")));
    if (!r) throw notFound("Linked channel");
    return c.json(r);
  })
  .get("/internal/telegram/channels", async (c) => c.json({ items: await linkedChannels() }))
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
    // a signal posted from the web has no channel post: its cards go to the verified channel
    const owner = s.tgChatId ? null : await db().query.providers.findFirst({ where: eq(providers.id, s.providerId) });
    return c.json({
      signal: { ...publicSignal(s, provider), pricePerSub: s.price },
      provider,
      post: s.tgChatId && s.tgMessageId ? { chatId: s.tgChatId, messageId: s.tgMessageId } : null,
      cardMessageId: s.tgCardMessageId,
      channelId: s.tgChatId ?? (owner?.channelVerifiedAt ? owner.channelId : null),
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
