import type { Api as TelegramApi, Context, SessionFlavor } from "grammy";
import type { JobName } from "@nundina/shared";
import type { Api } from "./api.js";
import type { Links } from "./cards.js";
import type { Extractor } from "./parser/index.js";

export interface SessionData {
  /** API user id for this Telegram account (cached after the first lookup). */
  userId?: number;
}

export type Ctx = Context & SessionFlavor<SessionData>;

/** Everything handlers and notifiers need; tests swap any of it. */
export interface Deps {
  api: Api;
  links: Links;
  /** LLM fallback parser; null when ANTHROPIC_API_KEY is unset. */
  llm: Extractor | null;
  /** Schedules a pg-boss job (reveal reminders). */
  schedule: (name: JobName, data: object, startAfter: Date, singletonKey: string) => Promise<unknown>;
  log: (level: "info" | "warn" | "error", msg: string, extra?: Record<string, unknown>) => void;
}

export type Telegram = TelegramApi;

/**
 * Sends a message, swallowing errors that mean "this recipient can't receive it" (blocked the bot,
 * never started it, chat gone). Anything else throws so the job is retried.
 */
export async function sendSafe(deps: Deps, tg: Telegram, chatId: number, text: string, other: Parameters<Telegram["sendMessage"]>[2] = {}) {
  try {
    return await tg.sendMessage(chatId, text, { parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...other });
  } catch (err) {
    const code = (err as { error_code?: number }).error_code;
    if (code === 403 || code === 400) {
      deps.log("warn", "telegram recipient unreachable", { chatId, error: (err as Error).message });
      return null;
    }
    throw err;
  }
}
