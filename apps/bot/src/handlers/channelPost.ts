import { Composer } from "grammy";
import { ApiError } from "../api.js";
import { draftCard } from "../cards.js";
import { sendSafe, type Ctx, type Deps } from "../context.js";
import { en } from "../i18n/en.js";
import { parseSignal } from "../parser/index.js";

const LINK = /^\/link(?:@\w+)?\s+([0-9a-f]{8})\b/i;

/** Channel posts: `/link <code>`, then signal detection in linked channels only. */
export function channelPostHandlers(deps: Deps) {
  const c = new Composer<Ctx>();

  c.on("channel_post", async (ctx) => {
    const post = ctx.channelPost;
    const text = post.text ?? post.caption;
    if (!text) return;

    const link = text.match(LINK);
    if (link) return linkChannel(ctx, deps, link[1]!);

    const provider = await deps.api.providerForChannel(ctx.chat.id);
    if (!provider) return; // not a linked provider channel

    const r = await parseSignal(text, { llm: deps.llm });
    if (!r.ok) {
      if (r.reason === "not_signal" || !provider.telegramId) return;
      const why = r.reason === "unsupported_market" ? en.unsupportedMarket(r.detail) : r.detail;
      await sendSafe(deps, ctx.api, provider.telegramId, en.draftRejected(why));
      return;
    }
    const draft = await deps.api.createDraft({
      providerHandle: provider.handle,
      rawText: text,
      parsed: r.signal,
      parser: r.parser,
      sourceChatId: ctx.chat.id,
      sourceMessageId: post.message_id,
    });
    deps.log("info", "draft from channel post", { draftId: draft.id, chatId: ctx.chat.id, parser: r.parser });
    if (provider.telegramId) {
      const card = draftCard(deps.links, draft.id, ctx.chat.title ?? provider.displayName, r.signal, r.parser);
      await sendSafe(deps, ctx.api, provider.telegramId, card.text, { reply_markup: card.keyboard });
    }
  });

  // A committed signal is immutable: say so under the edited post instead of re-parsing it.
  c.on("edited_channel_post", async (ctx) => {
    const post = ctx.editedChannelPost;
    const d = await deps.api.draftForPost(ctx.chat.id, post.message_id);
    if (!d) return;
    if (d.signalId) {
      await sendSafe(deps, ctx.api, ctx.chat.id, en.editedAfterCommit, {
        reply_parameters: { message_id: post.message_id, allow_sending_without_reply: true },
      });
      return;
    }
    const provider = await deps.api.providerForChannel(ctx.chat.id);
    if (provider?.telegramId && d.status !== "rejected") await sendSafe(deps, ctx.api, provider.telegramId, en.editedBeforeCommit);
  });

  return c;
}

async function linkChannel(ctx: Ctx & { chat: { id: number; title?: string } }, deps: Deps, code: string) {
  const me = await ctx.api.getChatMember(ctx.chat.id, ctx.me.id);
  const canPost = me.status === "administrator" && me.can_post_messages;
  if (!canPost) {
    await sendSafe(deps, ctx.api, ctx.chat.id, en.linkNeedsAdmin);
    return;
  }
  try {
    await deps.api.linkChannel(code, ctx.chat.id, ctx.chat.title ?? "");
  } catch (e) {
    if (e instanceof ApiError && e.status === 400) {
      await sendSafe(deps, ctx.api, ctx.chat.id, en.linkBadCode);
      return;
    }
    throw e;
  }
  // the code is single-use, but don't leave it in the channel
  await ctx.api.deleteMessage(ctx.chat.id, ctx.channelPost!.message_id).catch(() => undefined);
  const provider = await deps.api.providerForChannel(ctx.chat.id);
  if (provider?.telegramId) await sendSafe(deps, ctx.api, provider.telegramId, en.linkDone(ctx.chat.title ?? provider.displayName));
  deps.log("info", "channel linked", { chatId: ctx.chat.id, provider: provider?.handle });
}
