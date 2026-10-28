/**
 * Channel ownership checks. Telegram, not the person claiming the channel, says who owns it: the
 * bot reads the admin list itself and the API links the channel only when the provider's own
 * Telegram account is on it. Re-checked periodically so a sold or lost channel stops counting.
 */
import { ApiError, type ChannelFacts, type ChannelVerified } from "./api.js";
import { sendSafe, type Deps, type Telegram } from "./context.js";
import { webUrl } from "./cards.js";
import { en } from "./i18n/en.js";

export const ONBOARDING_PATH = "/start?role=provider";
export const RECHECK_MS = 6 * 3600_000;

/** Admin rights the one-tap "add to channel" link asks for. */
export const CHANNEL_RIGHTS = "post_messages+edit_messages+delete_messages";
export const addToChannelUrl = (botUsername: string) => `https://t.me/${botUsername}?startchannel&admin=${CHANNEL_RIGHTS}`;
/** Groups have no "post messages" admin right; being admin is what lets the bot read every message. */
export const GROUP_RIGHTS = "delete_messages+pin_messages";
export const addToGroupUrl = (botUsername: string) => `https://t.me/${botUsername}?startgroup&admin=${GROUP_RIGHTS}`;

/** Chat types a provider can verify and post signals in. */
export const LINKABLE = new Set(["channel", "supergroup", "group"]);

/**
 * Chats someone made the bot admin of before their Telegram was linked to a provider profile, so
 * the verification can finish on its own once they link (no need to remove and re-add the bot).
 * One bot instance, so process memory is enough; entries expire after a day.
 */
const PENDING_MS = 24 * 3600_000;
const pending = new Map<number, { chatId: number; at: number }>();
export function rememberPending(telegramId: number, chatId: number) {
  pending.set(telegramId, { chatId, at: Date.now() });
}
export function takePending(telegramId: number): number | null {
  const p = pending.get(telegramId);
  pending.delete(telegramId);
  return p && Date.now() - p.at < PENDING_MS ? p.chatId : null;
}

export async function channelFacts(tg: Telegram, chatId: number): Promise<ChannelFacts> {
  const [chat, admins, members] = await Promise.all([
    tg.getChat(chatId),
    tg.getChatAdministrators(chatId),
    tg.getChatMemberCount(chatId).catch(() => undefined),
  ]);
  return {
    channelId: chatId,
    title: ("title" in chat && chat.title) || "",
    username: ("username" in chat && chat.username) || undefined,
    members,
    admins: admins
      .filter((a) => !a.user.is_bot && (a.status === "creator" || a.status === "administrator"))
      .map((a) => ({ id: a.user.id, status: a.status as "creator" | "administrator" })),
  };
}

/** Whether the bot is admin and can post (result cards under signals). Groups have no post right. */
export async function botCanPost(tg: Telegram, chatId: number, botId: number) {
  const me = await tg.getChatMember(chatId, botId);
  return me.status === "administrator" && me.can_post_messages !== false;
}

export type VerifyOutcome =
  | { ok: true; result: ChannelVerified; facts: ChannelFacts }
  | { ok: false; code: string; message: string };

/** Turns the API's refusals into outcomes the caller explains to the person. */
export async function verify(run: () => Promise<ChannelVerified>, facts: ChannelFacts): Promise<VerifyOutcome> {
  try {
    return { ok: true, result: await run(), facts };
  } catch (e) {
    if (e instanceof ApiError && e.status >= 400 && e.status < 500) return { ok: false, code: e.status === 404 ? "no_provider" : e.code, message: e.message };
    throw e;
  }
}

/** After a successful link: a public note in the channel, and a DM to the provider. */
export async function announceVerified(deps: Deps, tg: Telegram, o: Extract<VerifyOutcome, { ok: true }>) {
  const { result: r, facts } = o;
  const profile = webUrl(deps.links, `/p/${r.provider.handle}`);
  await sendSafe(deps, tg, facts.channelId, en.channelVerifiedPost({ handle: r.provider.handle, url: profile }));
  await sendSafe(deps, tg, r.telegramId, en.channelVerifiedDm({ title: facts.title, role: r.role, members: facts.members, url: profile }));
  if (r.lookalikeOf) await sendSafe(deps, tg, r.telegramId, en.channelLookalike(r.lookalikeOf));
  deps.log("info", "channel verified", { chatId: facts.channelId, provider: r.provider.handle, role: r.role, lookalikeOf: r.lookalikeOf });
}

/** Tells the person why the channel wasn't linked (DM to whoever tried). */
export async function explainRefusal(deps: Deps, tg: Telegram, telegramId: number, o: Extract<VerifyOutcome, { ok: false }>) {
  const onboarding = webUrl(deps.links, ONBOARDING_PATH);
  const text =
    o.code === "no_provider"
      ? en.channelNoProvider(onboarding)
      : o.code === "not_channel_admin"
        ? en.channelNotAdmin
        : o.code === "channel_taken"
          ? en.channelTaken(o.message)
          : o.code === "connect_telegram"
            ? en.channelNoProvider(onboarding)
            : en.channelRefused(o.message);
  await sendSafe(deps, tg, telegramId, text);
}

/** Unlinks a channel and tells its owner why. */
export async function dropChannel(deps: Deps, tg: Telegram, chatId: number, why: string) {
  const r = await deps.api.unverifyChannel(chatId);
  if (!r) return;
  deps.log("info", "channel unverified", { chatId, provider: r.handle, why });
  if (r.telegramId) await sendSafe(deps, tg, r.telegramId, en.channelDropped(r.title ?? "your channel", why));
}

/**
 * For every linked channel: the bot must still be an admin that can post, and the provider must
 * still own or admin it. Otherwise the link is dropped. Survivors get fresh title, @username and
 * subscriber count.
 */
export async function recheckChannels(deps: Deps, tg: Telegram, botId: number) {
  const { items } = await deps.api.linkedChannels();
  let dropped = 0;
  for (const ch of items) {
    try {
      if (!(await botCanPost(tg, ch.channelId, botId))) {
        await dropChannel(deps, tg, ch.channelId, en.whyBotRemoved);
        dropped++;
        continue;
      }
      const facts = await channelFacts(tg, ch.channelId);
      if (!ch.telegramId || !facts.admins.some((a) => a.id === ch.telegramId)) {
        await dropChannel(deps, tg, ch.channelId, en.whyOwnerLeft);
        dropped++;
        continue;
      }
      await deps.api.verifyChannel(ch.telegramId, facts);
    } catch (e) {
      const code = (e as { error_code?: number }).error_code;
      // 400 chat not found / 403 bot kicked: the channel is gone for us
      if (code === 400 || code === 403) {
        await dropChannel(deps, tg, ch.channelId, en.whyBotRemoved);
        dropped++;
      } else deps.log("warn", "channel recheck failed", { chatId: ch.channelId, error: (e as Error).message });
    }
  }
  deps.log("info", "channels rechecked", { total: items.length, dropped });
  return { total: items.length, dropped };
}

/**
 * Checks the chat's admin list and links it to `telegramId`'s provider profile, then tells everyone
 * the outcome. If that account isn't linked to a profile yet, the chat is remembered and verified
 * once it is.
 */
export async function verifyChat(deps: Deps, tg: Telegram, chatId: number, telegramId: number) {
  const facts = await channelFacts(tg, chatId);
  const o = await verify(() => deps.api.verifyChannel(telegramId, facts), facts);
  deps.log("info", "channel verify attempt", { chatId, telegramId, ok: o.ok, code: o.ok ? null : o.code });
  if (o.ok) {
    await announceVerified(deps, tg, o);
    return o;
  }
  if (o.code === "no_provider" || o.code === "connect_telegram") rememberPending(telegramId, chatId);
  await explainRefusal(deps, tg, telegramId, o);
  return o;
}

/** Finishes a verification that waited for the account link; false when nothing was waiting. */
export async function finishPending(deps: Deps, tg: Telegram, telegramId: number) {
  const chatId = takePending(telegramId);
  if (chatId == null) return false;
  await verifyChat(deps, tg, chatId, telegramId);
  return true;
}
