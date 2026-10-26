import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../../api/src/db/client.js";
import { settlements, signals } from "../../api/src/db/schema.js";
import { stopQueue } from "../../api/src/jobs/queue.js";
import { notifyKeyDelivered, notifyLocked, notifyResult, notifyRevealReminder } from "../src/notify/index.js";
import { harness, insertBuyer, insertSignal, telegramProvider } from "./harness.js";

const CHANNEL = -1002000000001;
const PROVIDER_TG = 7101;

describe("notifications", () => {
  let h: ReturnType<typeof harness>;
  let providerId: number;

  beforeAll(async () => {
    h = harness();
    ({ providerId } = await telegramProvider(PROVIDER_TG));
  });
  afterAll(async () => {
    await stopQueue();
    await closeDb();
  });

  it("notify.locked: card under the post, provider DM, reveal reminder; never posted twice", async () => {
    const validUntil = new Date(Date.now() + 24 * 3600_000);
    const s = await insertSignal({ providerId, chatId: CHANNEL, messageId: 77, validUntil });
    await notifyLocked(h.deps, h.bot.api, { signalId: s.id.toString(), providerId });

    const card = h.sent(CHANNEL).at(-1)!.payload;
    expect(card.text).toMatch(/🔒 <b>Locked on HashKey<\/b> · BTC\/USD · expires 24h · price 0.50 USDT · refund if wrong/);
    expect(card.text).not.toMatch(/LONG|SHORT/); // the side stays secret until reveal
    expect(card.reply_parameters.message_id).toBe(77);
    const [buy, proof] = card.reply_markup.inline_keyboard[0];
    expect(buy.url).toBe(`https://t.me/nundina_test_bot?start=buy_${s.id}`);
    expect(proof.url).toBe(`https://app.test/signal/${s.id}`);

    const row = await db().query.signals.findFirst({ where: eq(signals.id, s.id) });
    expect(row!.tgCardMessageId).toBeGreaterThan(0);
    expect(h.sent(PROVIDER_TG).at(-1)!.payload.text).toMatch(/locked on-chain/);
    expect(h.scheduled[0]).toMatchObject({ name: "notify.revealReminder", key: `reveal-reminder:${s.id}` });
    expect(h.scheduled[0]!.startAfter.getTime()).toBe(validUntil.getTime() + 5 * 3600_000);

    const before = h.sent(CHANNEL).length;
    await notifyLocked(h.deps, h.bot.api, { signalId: s.id.toString(), providerId });
    expect(h.sent(CHANNEL)).toHaveLength(before);
  });

  it("notify.keyDelivered: unlock DM with an Open button, no plaintext", async () => {
    const s = await insertSignal({ providerId });
    const b = await insertBuyer(s.id, 8101);
    await notifyKeyDelivered(h.deps, h.bot.api, { purchaseId: b.purchaseId, signalId: s.id.toString() });
    const dm = h.sent(8101).at(-1)!.payload;
    expect(dm.text).toMatch(/Your signal is unlocked/);
    expect(dm.text).not.toMatch(/81500|entry/i);
    expect(dm.reply_markup.inline_keyboard[0][0].web_app.url).toBe(`https://app.test/tg/my?signal=${s.id}`);
  });

  it("notify.result: ❌ card under the locked card and a DM to every buyer", async () => {
    const s = await insertSignal({ providerId, chatId: CHANNEL, messageId: 88, validUntil: new Date(Date.now() + 3600_000) });
    await db().update(signals).set({ tgCardMessageId: 89, side: 0, revealedAt: new Date(), status: "SETTLED", outcome: "LOSS", rMultiple: "-1.00", resolveTx: `0x${"cd".repeat(32)}`, decidedAt: new Date(), purchaseCount: 2 }).where(eq(signals.id, s.id));
    await insertBuyer(s.id, 8201, "REFUNDED");
    await insertBuyer(s.id, 8202, "REFUNDED");
    await db().insert(settlements).values({ signalId: s.id, outcome: "LOSS", payout: "0", refundsTotal: "1000000", slashTotal: "1000000", settleTx: `0x${"ef".repeat(32)}`, settledAt: new Date() });

    await notifyResult(h.deps, h.bot.api, { signalId: s.id.toString(), outcome: "LOSS" });
    const card = h.sent(CHANNEL).at(-1)!.payload;
    expect(card.text).toMatch(/❌ <b>BTC LONG hit SL<\/b> · −1\.0R · Subscribers refunded \+ 0\.50 USDT each from bond/);
    expect(card.text).toMatch(/\/tx\/0xcdcd.*Proof.*\/tx\/0xefef.*Settlement/s);
    expect(card.reply_parameters.message_id).toBe(89);
    expect(h.sent(8201)).toHaveLength(1);
    expect(h.sent(8202)).toHaveLength(1);
  });

  it("reveal reminder only while the signal is unrevealed", async () => {
    const s = await insertSignal({ providerId, validUntil: new Date(Date.now() - 5 * 3600_000) });
    await notifyRevealReminder(h.deps, h.bot.api, { signalId: s.id.toString() });
    expect(h.sent(PROVIDER_TG).at(-1)!.payload.text).toMatch(/isn't revealed yet.*closes in (60 min|1h)/s);

    const n = h.sent(PROVIDER_TG).length;
    await db().update(signals).set({ status: "REVEALED", revealedAt: new Date() }).where(eq(signals.id, s.id));
    await notifyRevealReminder(h.deps, h.bot.api, { signalId: s.id.toString() });
    expect(h.sent(PROVIDER_TG)).toHaveLength(n);
  });

  it("a buyer who blocked the bot doesn't fail the job", async () => {
    const s = await insertSignal({ providerId });
    const b = await insertBuyer(s.id, 8301);
    h.bot.api.config.use(async (prev, method, payload, signal) => {
      if (method === "sendMessage" && (payload as any).chat_id === 8301)
        return { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" } as any;
      return prev(method, payload, signal);
    });
    await expect(notifyKeyDelivered(h.deps, h.bot.api, { purchaseId: b.purchaseId, signalId: s.id.toString() })).resolves.toBeUndefined();
  });
});
