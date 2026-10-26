/** Consumers of the API's notify.* jobs. Each is safe to run twice (pg-boss retries failed jobs). */
import type { PgBoss } from "pg-boss";
import { JOBS, type JobData } from "@nundina/shared";
import { lockedCard, resultCard, txUrl, unlockedCard } from "../cards.js";
import { sendSafe, type Deps, type Telegram } from "../context.js";
import { en } from "../i18n/en.js";

/** Reveal window after `validUntil` (SignalBook.REVEAL_WINDOW). The reminder goes out 1 h before it closes. */
export const REVEAL_WINDOW_S = 6 * 3600;
const REMINDER_LEAD_S = 3600;

/** Locked card under the channel post, a DM to the provider, and the reveal reminder. */
export async function notifyLocked(deps: Deps, tg: Telegram, { signalId }: JobData["notify.locked"]) {
  const n = await deps.api.signalNotify(signalId);
  if (!n) return;
  if (n.post && n.cardMessageId == null) {
    const card = lockedCard(deps.links, n.signal);
    const m = await sendSafe(deps, tg, n.post.chatId, card.text, {
      reply_markup: card.keyboard,
      reply_parameters: { message_id: n.post.messageId, allow_sending_without_reply: true },
    });
    if (m) await deps.api.saveCard(signalId, m.message_id);
  }
  if (n.provider.telegramId && n.signal.tx.commit) {
    await sendSafe(deps, tg, n.provider.telegramId, en.lockedProvider({ market: n.signal.market, url: txUrl(deps.links, n.signal.tx.commit) }));
  }
  const at = new Date(new Date(n.signal.validUntil).getTime() + (REVEAL_WINDOW_S - REMINDER_LEAD_S) * 1000);
  await deps.schedule(JOBS.notifyRevealReminder, { signalId }, at, `reveal-reminder:${signalId}`);
}

/** "Your signal is unlocked" DM. The key itself is fetched by the Mini App, never sent in chat. */
export async function notifyKeyDelivered(deps: Deps, tg: Telegram, { purchaseId }: JobData["notify.keyDelivered"]) {
  const p = await deps.api.purchaseNotify(purchaseId);
  if (!p?.telegramId || !p.signal) return;
  const card = unlockedCard(deps.links, p.signal);
  await sendSafe(deps, tg, p.telegramId, card.text, { reply_markup: card.keyboard });
}

/** Result card under the locked card in the channel, and a DM to every buyer. */
export async function notifyResult(deps: Deps, tg: Telegram, { signalId }: JobData["notify.result"]) {
  const n = await deps.api.signalNotify(signalId);
  if (!n) return;
  const card = resultCard(deps.links, n);
  if (n.post) {
    await sendSafe(deps, tg, n.post.chatId, card.text, {
      reply_markup: card.keyboard,
      reply_parameters: { message_id: n.cardMessageId ?? n.post.messageId, allow_sending_without_reply: true },
    });
  }
  const seen = new Set<number>();
  for (const b of n.buyers) {
    if (seen.has(b.telegramId)) continue;
    seen.add(b.telegramId);
    await sendSafe(deps, tg, b.telegramId, card.text, { reply_markup: card.keyboard });
  }
}

/** DM to the provider if the signal is still unrevealed an hour before the window closes. */
export async function notifyRevealReminder(deps: Deps, tg: Telegram, { signalId }: JobData["notify.revealReminder"], now = Date.now()) {
  const n = await deps.api.signalNotify(signalId);
  if (!n || n.signal.status !== "COMMITTED" || !n.provider.telegramId) return;
  const closes = new Date(n.signal.validUntil).getTime() + REVEAL_WINDOW_S * 1000;
  if (closes <= now) return;
  const mins = Math.round((closes - now) / 60_000);
  await sendSafe(deps, tg, n.provider.telegramId, en.revealReminder(n.signal.market, mins >= 90 ? `${Math.round(mins / 60)}h` : `${mins} min`));
}

/** Registers the bot's pg-boss workers. */
export async function startNotifyWorkers(boss: PgBoss, deps: Deps, tg: Telegram) {
  const handlers = {
    [JOBS.notifyLocked]: notifyLocked,
    [JOBS.notifyKeyDelivered]: notifyKeyDelivered,
    [JOBS.notifyResult]: notifyResult,
    [JOBS.notifyRevealReminder]: notifyRevealReminder,
  } as const;
  for (const [name, fn] of Object.entries(handlers)) {
    await boss.createQueue(name);
    await boss.work<any>(name, async (jobs) => {
      for (const j of jobs) await (fn as (d: Deps, t: Telegram, data: unknown) => Promise<void>)(deps, tg, j.data);
    });
  }
}
