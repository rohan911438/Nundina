import { Composer } from "grammy";
import { announceVerified, channelFacts, dropChannel, explainRefusal, verify } from "../channels.js";
import { sendSafe, type Ctx, type Deps } from "../context.js";
import { en } from "../i18n/en.js";

/**
 * The bot's own membership in channels. Being made admin by someone is the one-tap verification:
 * that someone is the provider claiming the channel, and Telegram's admin list must confirm it.
 * Losing admin (or being removed) unlinks the channel.
 */
export function membershipHandlers(deps: Deps) {
  const c = new Composer<Ctx>();

  c.on("my_chat_member", async (ctx) => {
    const u = ctx.myChatMember;
    if (u.chat.type !== "channel") return;
    const was = u.old_chat_member.status;
    const now = u.new_chat_member;

    if (now.status !== "administrator") {
      if (was === "administrator") await dropChannel(deps, ctx.api, u.chat.id, en.whyBotRemoved);
      return;
    }
    if (!now.can_post_messages) {
      await sendSafe(deps, ctx.api, u.from.id, en.channelNeedsPost(u.chat.title ?? ""));
      return;
    }
    // promoted again with the same rights: nothing changed
    if (was === "administrator" && (u.old_chat_member as { can_post_messages?: boolean }).can_post_messages) return;

    const facts = await channelFacts(ctx.api, u.chat.id);
    const o = await verify(() => deps.api.verifyChannel(u.from.id, facts), facts);
    if (o.ok) await announceVerified(deps, ctx.api, o);
    else await explainRefusal(deps, ctx.api, u.from.id, o);
  });

  return c;
}
