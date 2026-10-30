import { Composer } from "grammy";
import { announceVerified, botCanPost, channelFacts, verify } from "../channels.js";
import { draftCard } from "../cards.js";
import { sendSafe, type Ctx, type Deps } from "../context.js";
import { en } from "../i18n/en.js";
import { parseSignal } from "../parser/index.js";

const LINK = /^\/link(?:@\w+)?\s+([0-9a-f]{8})\b/i;

type Post = { chatId: number; title?: string; messageId: number; text: string };

/**
 * Posts in channels and groups: `/link <code>`, then signal detection where linked. In a group
 * only the provider's own messages (or posts made as the group by an anonymous admin) count;
 * other members can't post signals in the provider's name.
 */
export function channelPostHandlers(deps: Deps) {
  const c = new Composer<Ctx>();

  c.on("channel_post", async (ctx) => {
    const post = ctx.channelPost;
    const text = post.text ?? post.caption;
    if (!text) return;
    await onPost(ctx, deps, { chatId: ctx.chat.id, title: ctx.chat.title, messageId: post.message_id, text }, () => true);
  });

  c.chatType(["group", "supergroup"]).on("message", async (ctx) => {
    const m = ctx.message;
    const text = m.text ?? m.caption;
    if (!text) return;
    const asGroup = m.sender_chat?.id === ctx.chat.id;
    await onPost(ctx, deps, { chatId: ctx.chat.id, title: ctx.chat.title, messageId: m.message_id, text }, (telegramId) => asGroup || m.from?.id === telegramId);
  });

  // A committed signal is immutable: say so under the edited post instead of re-parsing it.
  const onEdit = async (ctx: Ctx, chatId: number, messageId: number) => {
    const d = await deps.api.draftForPost(chatId, messageId);
    if (!d) return;
    if (d.signalId) {
      await sendSafe(deps, ctx.api, chatId, en.editedAfterCommit, {
        reply_parameters: { message_id: messageId, allow_sending_without_reply: true },
      });
      return;
    }
    const provider = await deps.api.providerForChannel(chatId);
    if (provider?.telegramId && d.status !== "rejected") await sendSafe(deps, ctx.api, provider.telegramId, en.editedBeforeCommit);
  };
  c.on("edited_channel_post", (ctx) => onEdit(ctx, ctx.chat.id, ctx.editedChannelPost.message_id));
  c.chatType(["group", "supergroup"]).on("edited_message", (ctx) => onEdit(ctx, ctx.chat.id, ctx.editedMessage.message_id));

  return c;
}

async function onPost(ctx: Ctx, deps: Deps, post: Post, isProvider: (telegramId: number | null) => boolean) {
  const link = post.text.match(LINK);
  if (link) return linkChannel(ctx, deps, post, link[1]!);

  const provider = await deps.api.providerForChannel(post.chatId);
  if (!provider || !isProvider(provider.telegramId)) return; // not linked, or not the provider talking

  const r = await parseSignal(post.text, { llm: deps.llm });
  if (!r.ok) {
    if (r.reason === "not_signal" || !provider.telegramId) return;
    const why = r.reason === "unsupported_market" ? en.unsupportedMarket(r.detail) : r.detail;
    await sendSafe(deps, ctx.api, provider.telegramId, en.draftRejected(why));
    return;
  }
  const draft = await deps.api.createDraft({
    providerHandle: provider.handle,
    rawText: post.text,
    parsed: r.signal,
    parser: r.parser,
    sourceChatId: post.chatId,
    sourceMessageId: post.messageId,
  });
  deps.log("info", "draft from channel post", { draftId: draft.id, chatId: post.chatId, parser: r.parser });
  if (provider.telegramId) {
    const card = draftCard(deps.links, draft.id, post.title ?? provider.displayName, r.signal, r.parser);
    await sendSafe(deps, ctx.api, provider.telegramId, card.text, { reply_markup: card.keyboard });
  }
}

/** Fallback when the bot was already admin: the code says which profile, Telegram says who owns the chat. */
async function linkChannel(ctx: Ctx, deps: Deps, post: Post, code: string) {
  if (!(await botCanPost(ctx.api, post.chatId, ctx.me.id))) {
    await sendSafe(deps, ctx.api, post.chatId, en.linkNeedsAdmin);
    return;
  }
  // the code is single-use, but don't leave it in the chat either way
  await ctx.api.deleteMessage(post.chatId, post.messageId).catch(() => undefined);
  const facts = await channelFacts(ctx.api, post.chatId);
  const o = await verify(() => deps.api.linkChannel(code, facts), facts);
  if (o.ok) return announceVerified(deps, ctx.api, o);
  // channel posts are anonymous, so the refusal goes to the chat
  await sendSafe(deps, ctx.api, post.chatId, o.code === "bad_code" ? en.linkBadCode : en.channelRefused(o.message));
}
