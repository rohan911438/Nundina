/** Test harness: the real API app in-process (test DB) + a fake Telegram Bot API that records calls. */
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { MARKETS } from "@nundina/shared";
import { db, sql } from "../../api/src/db/client.js";
import { purchases, signals, users } from "../../api/src/db/schema.js";
import { app, makeProvider } from "../../api/test/helpers.js";
import { Api } from "../src/api.js";
import { createBot } from "../src/bot.js";
import type { Deps } from "../src/context.js";

export const BOT_INFO = {
  id: 999,
  is_bot: true as const,
  first_name: "Nundina",
  username: "nundina_test_bot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
};

export const LINKS = { chainId: 133, miniApp: "https://app.test/tg", web: "https://app.test", botUsername: BOT_INFO.username };

export interface Call {
  method: string;
  payload: any;
}

export function harness(opts: { admin?: boolean } = {}) {
  const calls: Call[] = [];
  const scheduled: { name: string; data: any; startAfter: Date; key: string }[] = [];
  let messageId = 5000;
  const deps: Deps = {
    api: new Api("http://api.test", "test-internal-secret-0123456789", (url, init) => Promise.resolve(app.request(url, init))),
    links: LINKS,
    llm: null,
    schedule: async (name, data, startAfter, key) => void scheduled.push({ name, data, startAfter, key }),
    log: () => {},
  };
  const bot = createBot("123:TEST", deps, { botInfo: BOT_INFO as any });
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload });
    let result: unknown = true;
    if (method === "sendMessage") result = { message_id: ++messageId, date: 0, chat: { id: (payload as any).chat_id, type: "private" }, text: (payload as any).text };
    if (method === "getChatMember")
      result = { status: opts.admin === false ? "member" : "administrator", can_post_messages: true, user: BOT_INFO };
    return { ok: true, result } as any;
  });

  let updateId = 1;
  const user = (id: number) => ({ id, is_bot: false, first_name: `User${id}`, username: `user${id}` });
  return {
    bot,
    deps,
    calls,
    scheduled,
    sent: (chatId?: number) => calls.filter((c) => c.method === "sendMessage" && (chatId == null || c.payload.chat_id === chatId)),
    reset: () => {
      calls.length = 0;
      scheduled.length = 0;
    },
    /** Private message from a user. */
    dm: (fromId: number, text: string) =>
      bot.handleUpdate({
        update_id: updateId++,
        message: {
          message_id: updateId,
          date: Math.floor(Date.now() / 1000),
          chat: { id: fromId, type: "private", first_name: `User${fromId}` },
          from: user(fromId),
          text,
          ...(text.startsWith("/") ? { entities: [{ type: "bot_command", offset: 0, length: text.split(" ")[0]!.length }] } : {}),
        },
      } as any),
    channelPost: (chatId: number, messageId: number, text: string, title = "Alpha Calls") =>
      bot.handleUpdate({
        update_id: updateId++,
        channel_post: { message_id: messageId, date: Math.floor(Date.now() / 1000), chat: { id: chatId, type: "channel", title }, text },
      } as any),
    editedChannelPost: (chatId: number, messageId: number, text: string) =>
      bot.handleUpdate({
        update_id: updateId++,
        edited_channel_post: { message_id: messageId, date: 0, edit_date: 1, chat: { id: chatId, type: "channel", title: "Alpha Calls" }, text },
      } as any),
    callback: (fromId: number, data: string, messageId = 1) =>
      bot.handleUpdate({
        update_id: updateId++,
        callback_query: {
          id: String(updateId),
          from: user(fromId),
          chat_instance: "x",
          data,
          message: { message_id: messageId, date: 0, chat: { id: fromId, type: "private", first_name: "x" }, text: "draft" },
        },
      } as any),
  };
}

/** A provider whose user has a Telegram id (as after a Mini App login). */
export async function telegramProvider(telegramId: number) {
  const account = privateKeyToAccount(generatePrivateKey());
  const p = await makeProvider({ address: account.address });
  await db().update(users).set({ telegramId }).where(eq(users.id, p.userId));
  return p;
}

/** A committed signal row (as the API writes it on confirm) posted from a channel. */
export async function insertSignal(opts: { providerId: number; chatId?: number; messageId?: number; validUntil?: Date; price?: string; status?: string }) {
  // ids above the seed range; test files share one database
  const [row] = await sql()<{ next: string }[]>`select greatest(coalesce(max(id), 0), 9000000) + 1 as next from signals`;
  const id = BigInt(row!.next);
  const [s] = await db()
    .insert(signals)
    .values({
      id,
      providerId: opts.providerId,
      commitHash: `0x${randomBytes(32).toString("hex")}`,
      market: "BTC/USD",
      marketId: MARKETS["BTC/USD"].id,
      validUntil: opts.validUntil ?? new Date(Date.now() + 24 * 3600_000),
      committedAt: new Date("2026-10-26T14:02:00Z"),
      price: opts.price ?? "500000",
      status: opts.status ?? "COMMITTED",
      commitTx: `0x${"ab".repeat(32)}`,
      tgChatId: opts.chatId,
      tgMessageId: opts.messageId,
      source: "seed",
    })
    .returning();
  return s!;
}

/** A paid purchase by a Telegram user. */
export async function insertBuyer(signalId: bigint, telegramId: number, status = "KEY_SENT") {
  const account = privateKeyToAccount(generatePrivateKey());
  const [u] = await db().insert(users).values({ wallet: account.address.toLowerCase(), telegramId }).returning();
  const [p] = await db()
    .insert(purchases)
    .values({ signalId, buyerUserId: u!.id, buyerAddress: account.address.toLowerCase(), amount: "500000", token: `0x${"11".repeat(20)}`, rail: "mock", status })
    .returning();
  return { userId: u!.id, purchaseId: p!.id };
}
