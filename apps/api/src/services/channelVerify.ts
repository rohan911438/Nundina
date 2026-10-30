import { and, eq, isNotNull, ne } from "drizzle-orm";
import { db } from "../db/client.js";
import { providers, users } from "../db/schema.js";
import { ApiError, badRequest, conflict, notFound } from "../lib/errors.js";
import { lookalikeOf } from "./lookalike.js";
import { providerOfUser } from "./providerOfUser.js";

export interface ChannelFacts {
  channelId: number;
  title: string;
  /** Public @username, without the @; absent for private channels. */
  username?: string | null;
  members?: number | null;
  /** From getChatAdministrators, so the bot can't be told who owns the channel. */
  admins: { id: number; status: "creator" | "administrator" }[];
}

/** The provider profile of whoever holds this Telegram account, or null. */
export async function providerOfTelegram(telegramId: number) {
  const u = await db().query.users.findFirst({ where: eq(users.telegramId, telegramId) });
  if (!u) return null;
  return providerOfUser(u.id, u.wallet);
}

/**
 * Links a channel to a provider only if the provider's own Telegram account is the channel's owner
 * or an admin (as Telegram reports it to the bot), and no other provider already holds it. Flags
 * names that resemble an established provider's, so buyers get a warning on lookalike channels.
 */
export async function verifyChannel(providerId: number, f: ChannelFacts) {
  const p = await db().query.providers.findFirst({ where: eq(providers.id, providerId) });
  if (!p) throw notFound("Provider");
  const owner = p.userId ? await db().query.users.findFirst({ where: eq(users.id, p.userId) }) : null;
  if (!owner?.telegramId) {
    throw badRequest("connect_telegram", "Connect your Telegram account in the app first, so we can check you own the channel");
  }
  const me = f.admins.find((a) => a.id === owner.telegramId);
  if (!me) {
    throw new ApiError(403, "not_channel_admin", "Your Telegram account isn't an owner or admin of this channel, so it can't be linked to your profile");
  }
  const holder = await db().query.providers.findFirst({ where: and(eq(providers.channelId, f.channelId), ne(providers.id, providerId)) });
  if (holder) throw conflict("channel_taken", `This channel is already verified by @${holder.handle}`);

  const others = await db()
    .select({
      handle: providers.handle,
      displayName: providers.displayName,
      channelTitle: providers.channelTitle,
      channelUsername: providers.channelUsername,
      createdAt: providers.createdAt,
    })
    .from(providers)
    .where(and(isNotNull(providers.channelVerifiedAt), ne(providers.id, providerId)));
  // only providers who were here first can be impersonated
  const established = others
    .filter((o) => o.createdAt < p.createdAt)
    .map((o) => ({ handle: o.handle, names: [o.channelUsername, o.channelTitle, o.displayName, o.handle] }));
  const lookalike = lookalikeOf([f.username, f.title, p.displayName, p.handle], established);

  const [row] = await db()
    .update(providers)
    .set({
      channelId: f.channelId,
      channelTitle: f.title,
      channelUsername: f.username ?? null,
      channelMembers: f.members ?? null,
      channelRole: me.status,
      channelVerifiedAt: new Date(),
      lookalikeOf: lookalike,
    })
    .where(eq(providers.id, providerId))
    .returning();
  return { provider: row!, role: me.status, lookalikeOf: lookalike, telegramId: owner.telegramId };
}

/** The bot lost admin, or the provider lost theirs: the channel stops being theirs on Nundina. */
export async function unverifyChannel(channelId: number) {
  const p = await db().query.providers.findFirst({ where: eq(providers.channelId, channelId) });
  if (!p) return null;
  await db()
    .update(providers)
    .set({ channelId: null, channelRole: null, channelVerifiedAt: null })
    .where(eq(providers.id, p.id));
  const owner = p.userId ? await db().query.users.findFirst({ where: eq(users.id, p.userId) }) : null;
  return { handle: p.handle, title: p.channelTitle, telegramId: owner?.telegramId ?? null };
}

/** Every linked channel with its owner's Telegram id, for the bot's periodic re-check. */
export async function linkedChannels() {
  const rows = await db()
    .select({ channelId: providers.channelId, providerId: providers.id, handle: providers.handle, telegramId: users.telegramId })
    .from(providers)
    .leftJoin(users, eq(users.id, providers.userId))
    .where(isNotNull(providers.channelId));
  return rows.map((r) => ({ ...r, channelId: r.channelId! }));
}
