import type { Transformer } from "grammy";

type Button = { text: string; url?: string; web_app?: { url: string } } & Record<string, unknown>;

/** Telegram rejects the whole message if one button links to localhost, or a Mini App isn't HTTPS. */
export function buttonUsable(b: Button): boolean {
  const u = b.web_app?.url ?? b.url;
  if (u == null) return true;
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return false;
  }
  if (["localhost", "127.0.0.1", "0.0.0.0", "[::1]"].includes(url.hostname)) return false;
  return b.web_app ? url.protocol === "https:" : url.protocol === "https:" || url.protocol === "http:" || url.protocol === "tg:";
}

/**
 * API transformer: drops buttons Telegram would refuse (local dev URLs) so the message itself still
 * goes out. Warns once per process so a misconfigured MINI_APP_URL / WEB_URL is visible in the log.
 */
export function dropUnusableButtons(warn: (msg: string, extra: Record<string, unknown>) => void): Transformer {
  let warned = false;
  return (prev, method, payload, signal) => {
    const markup = (payload as { reply_markup?: { inline_keyboard?: Button[][] } } | undefined)?.reply_markup;
    if (markup?.inline_keyboard) {
      const dropped: string[] = [];
      const rows = markup.inline_keyboard
        .map((row) =>
          row.filter((b) => {
            const ok = buttonUsable(b);
            if (!ok) dropped.push(b.web_app?.url ?? b.url ?? b.text);
            return ok;
          }),
        )
        .filter((row) => row.length > 0);
      if (dropped.length) {
        if (!warned) warn("buttons dropped: Telegram needs public URLs (and HTTPS for Mini Apps); set WEB_URL / MINI_APP_URL", { method, dropped });
        warned = true;
        payload = { ...payload, reply_markup: rows.length ? { ...markup, inline_keyboard: rows } : undefined } as typeof payload;
      }
    }
    return prev(method, payload, signal);
  };
}
