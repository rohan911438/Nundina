import { Composer } from "grammy";
import { ApiError } from "../api.js";
import type { Ctx, Deps } from "../context.js";
import { en } from "../i18n/en.js";

/** Inline button actions (Confirm and Edit open the Mini App directly; only Ignore comes here). */
export function callbackHandlers(deps: Deps) {
  const c = new Composer<Ctx>();

  c.callbackQuery(/^ignore:(\d+)$/, async (ctx) => {
    try {
      await deps.api.ignoreDraft(Number(ctx.match[1]));
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) throw e; // already committed or ignored
    }
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(en.draftIgnored).catch(() => undefined);
  });

  c.on("callback_query:data", (ctx) => ctx.answerCallbackQuery());
  return c;
}
