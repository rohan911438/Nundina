import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { telegramAccountLinks, users } from "../db/schema.js";
import { badRequest, conflict } from "../lib/errors.js";
import { bytesToHex, randomBytes } from "../lib/crypto.js";

const LINK_TTL_MS = 10 * 60 * 1000;

/**
 * Puts a Telegram account on a wallet user, so bot DMs, channel checks and Mini App calls all
 * resolve to the same account. A Telegram-only row (made when someone first messages the bot)
 * gives up the id; one already holding another wallet keeps it: one Telegram account, one wallet.
 */
export async function bindTelegram(userId: number, telegramId: number, username?: string | null) {
  const holder = await db().query.users.findFirst({ where: eq(users.telegramId, telegramId) });
  if (holder?.id === userId) {
    if (username !== undefined && holder.telegramUsername !== username) {
      await db().update(users).set({ telegramUsername: username }).where(eq(users.id, userId));
    }
    return;
  }
  if (holder?.wallet) throw conflict("telegram_linked", "This Telegram account is already linked to another wallet");
  await db().transaction(async (tx) => {
    if (holder) await tx.update(users).set({ telegramId: null }).where(eq(users.id, holder.id));
    await tx.update(users).set({ telegramId, telegramUsername: username ?? null }).where(eq(users.id, userId));
  });
}

const newToken = () => bytesToHex(randomBytes(9));

/** Web side starts: the token goes into a t.me deep link; the bot redeems it with the sender's id. */
export async function startLinkFromWeb(userId: number) {
  const token = newToken();
  await db().insert(telegramAccountLinks).values({ token, userId, expiresAt: new Date(Date.now() + LINK_TTL_MS) });
  return { token, expiresInS: LINK_TTL_MS / 1000 };
}

/** Bot side starts (/connect): the token goes into a web link that a signed-in wallet redeems. */
export async function startLinkFromBot(telegramId: number, username?: string | null) {
  const token = newToken();
  await db()
    .insert(telegramAccountLinks)
    .values({ token, telegramId, telegramUsername: username ?? null, expiresAt: new Date(Date.now() + LINK_TTL_MS) });
  return { token, expiresInS: LINK_TTL_MS / 1000 };
}

async function claim(token: string) {
  const [row] = await db()
    .update(telegramAccountLinks)
    .set({ usedAt: new Date() })
    .where(and(eq(telegramAccountLinks.token, token), isNull(telegramAccountLinks.usedAt), gt(telegramAccountLinks.expiresAt, new Date())))
    .returning();
  if (!row) throw badRequest("bad_link", "This link expired or was already used. Start again from the app.");
  return row;
}

/** The bot got `/start acct_<token>` from this Telegram account. Returns the linked user's wallet. */
export async function redeemInBot(token: string, telegramId: number, username?: string | null) {
  const row = await claim(token);
  if (!row.userId) throw badRequest("bad_link", "This link is not meant for the bot");
  await bindTelegram(row.userId, telegramId, username);
  const u = await db().query.users.findFirst({ where: eq(users.id, row.userId) });
  return { userId: row.userId, wallet: u?.wallet ?? null };
}

/** A signed-in wallet opened the bot's /connect link. */
export async function redeemOnWeb(token: string, userId: number) {
  const row = await claim(token);
  if (!row.telegramId) throw badRequest("bad_link", "This link is not meant for the web");
  await bindTelegram(userId, row.telegramId, row.telegramUsername);
  return { telegramId: row.telegramId, telegramUsername: row.telegramUsername };
}
