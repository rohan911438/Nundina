import { describe, expect, it, vi } from "vitest";
import { buttonUsable, dropUnusableButtons } from "../src/buttons.js";

describe("button guard", () => {
  it("knows what Telegram accepts", () => {
    expect(buttonUsable({ text: "a", url: "https://app.test/s/1" })).toBe(true);
    expect(buttonUsable({ text: "a", url: "https://t.me/bot?start=x" })).toBe(true);
    expect(buttonUsable({ text: "a", url: "http://localhost:3000/s/1" })).toBe(false);
    expect(buttonUsable({ text: "a", web_app: { url: "http://app.test/tg" } })).toBe(false);
    expect(buttonUsable({ text: "a", web_app: { url: "https://app.test/tg" } })).toBe(true);
    expect(buttonUsable({ text: "a", callback_data: "x" })).toBe(true);
    expect(buttonUsable({ text: "a", url: "" })).toBe(false);
  });

  it("drops unusable buttons and empty rows, keeps the message", async () => {
    const warn = vi.fn();
    const prev = vi.fn(async (_m: string, p: unknown) => ({ ok: true, result: p }) as any);
    const t = dropUnusableButtons(warn);
    const payload = {
      chat_id: 1,
      text: "hi",
      reply_markup: { inline_keyboard: [[{ text: "Open", web_app: { url: "http://localhost:3000/tg/my" } }], [{ text: "Buy", url: "https://t.me/b?start=1" }, { text: "Proof", url: "http://localhost:3000/s/1" }]] },
    };
    await t(prev as any, "sendMessage", payload as any);
    expect(prev.mock.calls[0]![1]).toEqual({ chat_id: 1, text: "hi", reply_markup: { inline_keyboard: [[{ text: "Buy", url: "https://t.me/b?start=1" }]] } });
    expect(warn).toHaveBeenCalledTimes(1);

    await t(prev as any, "sendMessage", { chat_id: 1, text: "x", reply_markup: { inline_keyboard: [[{ text: "Open", web_app: { url: "http://localhost/tg" } }]] } } as any);
    expect((prev.mock.calls[1]![1] as any).reply_markup).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1); // once per process
  });
});
