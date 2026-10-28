import { Composer } from "grammy";
import { LINKABLE, dropChannel, verifyChat } from "../channels.js";
import { sendSafe, type Ctx, type Deps } from "../context.js";
import { en } from "../i18n/en.js";

/**
 * The bot's own membership in channels and groups. Being made admin by someone is the one-tap
 * verification: that someone is the provider claiming the chat, and Telegram's admin list must
 * confirm it. Losing admin (or being removed) unlinks it.
 */
export function membershipHandlers(deps: Deps) {
  const c = new Composer<Ctx>();

  c.on("my_chat_member", async (ctx) => {
    const u = ctx.myChatMember;
    if (!LINKABLE.has(u.chat.type)) return;
    const was = u.old_chat_member.status;
    const now = u.new_chat_member;
    deps.log("info", "bot membership changed", { chatId: u.chat.id, type: u.chat.type, from: was, to: now.status, by: u.from.id });

    if (now.status !== "administrator") {
      if (was === "administrator") await dropChannel(deps, ctx.api, u.chat.id, en.whyBotRemoved);
      // added to a group as a plain member: it can't read messages, ask for admin
      else if (u.chat.type !== "channel" && now.status === "member") await sendSafe(deps, ctx.api, u.from.id, en.groupNeedsAdmin("title" in u.chat ? (u.chat.title ?? "") : ""));
      return;
    }
    // channels have a "post messages" right; groups don't (admin can always post)
    if (now.can_post_messages === false) {
      await sendSafe(deps, ctx.api, u.from.id, en.channelNeedsPost("title" in u.chat ? (u.chat.title ?? "") : ""));
      return;
    }
    // promoted again with rights that were already enough: nothing changed
    if (was === "administrator" && (u.old_chat_member as { can_post_messages?: boolean }).can_post_messages !== false) return;

    await verifyChat(deps, ctx.api, u.chat.id, u.from.id);
  });

  return c;
}
