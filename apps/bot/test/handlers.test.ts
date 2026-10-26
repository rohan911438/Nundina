import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "../../api/src/db/client.js";
import { providers, signalDrafts } from "../../api/src/db/schema.js";
import { stopQueue } from "../../api/src/jobs/queue.js";
import { harness, insertSignal, telegramProvider } from "./harness.js";

const CHANNEL = -1001234567890;
const PROVIDER_TG = 7001;
const SIGNAL_POST = "#BTC/USDT LONG\nEntry: 81500\nTargets: 84000 - 86000\nStop: 80200";

describe("bot handlers", () => {
  let h: ReturnType<typeof harness>;
  let provider: Awaited<ReturnType<typeof telegramProvider>>;

  beforeAll(async () => {
    provider = await telegramProvider(PROVIDER_TG);
  });
  beforeEach(() => {
    h = harness();
  });
  afterAll(async () => {
    await stopQueue();
    await closeDb();
  });

  it("/link_channel → /link <code> in the channel links it and DMs the provider", async () => {
    await h.dm(PROVIDER_TG, "/link_channel");
    const steps = h.sent(PROVIDER_TG).at(-1)!.payload.text as string;
    const code = steps.match(/\/link ([0-9A-F]{8})/)![1]!;

    h.reset();
    await h.channelPost(CHANNEL, 10, `/link ${code}`);
    const p = await db().query.providers.findFirst({ where: eq(providers.id, provider.providerId) });
    expect(p!.channelId).toBe(CHANNEL);
    expect(p!.channelTitle).toBe("Alpha Calls");
    expect(h.calls.some((c) => c.method === "deleteMessage" && c.payload.message_id === 10)).toBe(true);
    expect(h.sent(PROVIDER_TG).at(-1)!.payload.text).toMatch(/Linked <b>Alpha Calls<\/b>/);
  });

  it("refuses to link when the bot is not an admin who can post", async () => {
    const h2 = harness({ admin: false });
    await h2.channelPost(-100999, 11, "/link ABCDEF12");
    expect(h2.sent(-100999).at(-1)!.payload.text).toMatch(/admin/);
  });

  it("a non-provider gets told to register first", async () => {
    await h.dm(7999, "/link_channel");
    expect(h.sent(7999).at(-1)!.payload.text).toMatch(/not registered as a provider/);
  });

  it("signal post in a linked channel → draft + confirm DM to the provider", async () => {
    await h.channelPost(CHANNEL, 20, SIGNAL_POST);
    const d = await db().query.signalDrafts.findFirst({
      where: and(eq(signalDrafts.sourceChatId, CHANNEL), eq(signalDrafts.sourceMessageId, 20)),
    });
    expect(d).toMatchObject({ providerId: provider.providerId, parser: "rules", status: "pending", rawText: SIGNAL_POST });
    expect(d!.parsedJson).toMatchObject({ market: "BTC/USD", side: "LONG", entry: "81500", takeProfit: "84000", stopLoss: "80200" });

    const dm = h.sent(PROVIDER_TG).at(-1)!.payload;
    expect(dm.text).toMatch(/BTC\/USD · LONG/);
    expect(dm.text).toMatch(/first \(84000\) is the take profit/);
    const buttons = dm.reply_markup.inline_keyboard.flat();
    expect(buttons[0]).toMatchObject({ text: "Confirm & lock", web_app: { url: `https://app.test/tg/confirm/${d!.id}` } });
    expect(buttons.at(-1)).toMatchObject({ text: "Ignore", callback_data: `ignore:${d!.id}` });
    // nothing is posted in the channel before the provider confirms
    expect(h.sent(CHANNEL)).toHaveLength(0);
  });

  it("ignores posts in channels that aren't linked, and plain commentary", async () => {
    await h.channelPost(-100555, 1, SIGNAL_POST);
    await h.channelPost(CHANNEL, 21, "BTC looking strong today, might go long soon");
    expect(h.calls.filter((c) => c.method === "sendMessage")).toHaveLength(0);
    expect(await db().query.signalDrafts.findFirst({ where: eq(signalDrafts.sourceChatId, -100555) })).toBeUndefined();
  });

  it("explains a post it could not use", async () => {
    await h.channelPost(CHANNEL, 22, "#ETH/USDT LONG\nEntry: 3200\nTarget: 3400\nStop: 3100");
    expect(h.sent(PROVIDER_TG).at(-1)!.payload.text).toMatch(/ETH isn't supported yet/);
    await h.channelPost(CHANNEL, 23, "BTC LONG 81500 TP 82000 SL 80000");
    expect(h.sent(PROVIDER_TG).at(-1)!.payload.text).toMatch(/Reward:risk must be at least 1:1/);
  });

  it("Ignore button rejects the draft", async () => {
    await h.channelPost(CHANNEL, 30, SIGNAL_POST);
    const d = await db().query.signalDrafts.findFirst({ where: and(eq(signalDrafts.sourceChatId, CHANNEL), eq(signalDrafts.sourceMessageId, 30)) });
    await h.callback(PROVIDER_TG, `ignore:${d!.id}`);
    const after = await db().query.signalDrafts.findFirst({ where: eq(signalDrafts.id, d!.id) });
    expect(after!.status).toBe("rejected");
    expect(h.calls.some((c) => c.method === "editMessageText" && /Ignored/.test(c.payload.text))).toBe(true);
  });

  it("edited post after commit → 'already locked' reply under it", async () => {
    await h.channelPost(CHANNEL, 40, SIGNAL_POST);
    const d = await db().query.signalDrafts.findFirst({ where: and(eq(signalDrafts.sourceChatId, CHANNEL), eq(signalDrafts.sourceMessageId, 40)) });
    const s = await insertSignal({ providerId: provider.providerId, chatId: CHANNEL, messageId: 40 });
    await db().update(signalDrafts).set({ status: "committed", signalId: s.id }).where(eq(signalDrafts.id, d!.id));

    h.reset();
    await h.editedChannelPost(CHANNEL, 40, SIGNAL_POST.replace("80200", "79000"));
    const reply = h.sent(CHANNEL).at(-1)!.payload;
    expect(reply.text).toMatch(/Already locked/);
    expect(reply.reply_parameters.message_id).toBe(40);
  });

  it("/start buy_<id> answers with the Mini App buy button; /start shows the disclaimer", async () => {
    const s = await insertSignal({ providerId: provider.providerId });
    await h.dm(8001, `/start buy_${s.id}`);
    const m = h.sent(8001).at(-1)!.payload;
    expect(m.text).toMatch(/Price 0.50 USDT/);
    expect(m.reply_markup.inline_keyboard[0][0]).toMatchObject({ text: "Buy", web_app: { url: `https://app.test/tg/buy/${s.id}` } });

    await h.dm(8001, "/start");
    expect(h.sent(8001).at(-1)!.payload.text).toMatch(/not financial advice/);
    await h.dm(8001, "/buy 424242");
    expect(h.sent(8001).at(-1)!.payload.text).toMatch(/couldn't find/);
  });

  it("/signals lists live signals with buy deep links", async () => {
    await h.dm(8002, "/signals");
    const m = h.sent(8002).at(-1)!.payload;
    expect(m.text).toMatch(/Live signals/);
    expect(m.reply_markup.inline_keyboard[0][0].url).toMatch(/^https:\/\/t\.me\/nundina_test_bot\?start=buy_\d+$/);
  });

  it("/my and /agent work for a new user", async () => {
    await h.dm(8003, "/my");
    expect(h.sent(8003).at(-1)!.payload.text).toMatch(/haven't bought/);
    await h.dm(8003, "/agent");
    expect(h.sent(8003).at(-1)!.payload.text).toMatch(/don't have a trading agent/);
  });

  it("rate-limits a user who spams commands", async () => {
    for (let i = 0; i < 8; i++) await h.dm(8004, "/help");
    expect(h.sent(8004).some((c) => /Slow down/.test(c.payload.text))).toBe(true);
    expect(h.sent(8004).filter((c) => /Commands/.test(c.payload.text)).length).toBeLessThanOrEqual(5);
  });
});
