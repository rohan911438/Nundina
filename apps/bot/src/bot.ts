import { Bot, MemorySessionStorage, session, type StorageAdapter } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { autoRetry } from "@grammyjs/auto-retry";
import { limit } from "@grammyjs/ratelimiter";
import { dropUnusableButtons } from "./buttons.js";
import type { Ctx, Deps, SessionData } from "./context.js";
import { callbackHandlers } from "./handlers/callbacks.js";
import { channelPostHandlers } from "./handlers/channelPost.js";
import { commandHandlers } from "./handlers/commands.js";
import { membershipHandlers } from "./handlers/membership.js";
import { en } from "./i18n/en.js";

export const ALLOWED_UPDATES = ["message", "channel_post", "edited_channel_post", "callback_query", "my_chat_member"] as const;

export function createBot(
  token: string,
  deps: Deps,
  opts: { botInfo?: UserFromGetMe; storage?: StorageAdapter<SessionData> } = {},
) {
  const bot = new Bot<Ctx>(token, { botInfo: opts.botInfo });
  bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 30 }));
  bot.api.config.use(dropUnusableButtons((msg, extra) => deps.log("warn", msg, extra)));

  // per-user rate limit on private chats; channel posts are never limited
  bot.use(
    limit({
      timeFrame: 3000,
      limit: 5,
      keyGenerator: (ctx) => (ctx.chat?.type === "private" ? ctx.from?.id.toString() : undefined),
      onLimitExceeded: async (ctx) => {
        await ctx.reply(en.slowDown).catch(() => undefined);
      },
    }),
  );
  bot.use(
    session({
      initial: (): SessionData => ({}),
      storage: opts.storage ?? new MemorySessionStorage<SessionData>(),
      getSessionKey: (ctx) => (ctx.chat?.type === "private" ? ctx.from?.id.toString() : undefined),
    }),
  );

  bot.use(membershipHandlers(deps));
  bot.use(channelPostHandlers(deps));
  bot.use(commandHandlers(deps));
  bot.use(callbackHandlers(deps));

  bot.catch(async (err) => {
    deps.log("error", "update failed", { error: err.error instanceof Error ? err.error.message : String(err.error), update: err.ctx.update.update_id });
    if (err.ctx.chat?.type === "private") await err.ctx.reply(en.error).catch(() => undefined);
  });
  return bot;
}
