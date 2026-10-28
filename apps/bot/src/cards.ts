/** Message templates: pure functions from API data to `{ text, keyboard }` (HTML). */
import { InlineKeyboard } from "grammy";
import { explorerTx, fromUnits } from "@nundina/shared";
import type { PublicSignal, SignalNotify } from "./api.js";
import { en } from "./i18n/en.js";
import type { ParsedSignal } from "./parser/index.js";

export interface Links {
  chainId: number;
  miniApp: string;
  web: string;
  botUsername: string;
}

export interface Card {
  text: string;
  keyboard?: InlineKeyboard;
}

export const miniApp = (l: Links, path: string) => `${l.miniApp.replace(/\/$/, "")}${path}`;
export const webUrl = (l: Links, path: string) => `${l.web.replace(/\/$/, "")}${path}`;
export const deepLink = (l: Links, payload: string) => `https://t.me/${l.botUsername}?start=${payload}`;
/** "0.5" → "0.50" */
export const usd = (v: string) => Number(v).toFixed(2);
export const txUrl = (l: Links, hash: string) => explorerTx(l.chainId, hash);

/** Hours left until `iso`, rounded, at least 1. */
export function hoursLeft(iso: string, now = Date.now()) {
  return Math.max(1, Math.round((new Date(iso).getTime() - now) / 3_600_000));
}

/** "14:02 UTC" */
export function clock(iso: string) {
  return `${new Date(iso).toISOString().slice(11, 16)} UTC`;
}

function rr(s: ParsedSignal) {
  const e = Number(s.entry);
  const reward = Math.abs(Number(s.takeProfit) - e);
  const risk = Math.abs(e - Number(s.stopLoss));
  return risk ? (reward / risk).toFixed(2) : "–";
}

/** DM to the provider after a channel post was parsed. */
export function draftCard(l: Links, draftId: number, channel: string, s: ParsedSignal, parser: string): Card {
  return {
    text: en.draft({ channel, market: s.market, side: s.side, entry: s.entry, tp: s.takeProfit, sl: s.stopLoss, rr: rr(s), hours: s.validHours, notes: s.notes, parser }),
    keyboard: new InlineKeyboard()
      .webApp(en.buttons.confirm, miniApp(l, `/confirm/${draftId}`))
      .row()
      .webApp(en.buttons.edit, miniApp(l, `/confirm/${draftId}?edit=1`))
      .text(en.buttons.ignore, `ignore:${draftId}`),
  };
}

/**
 * Reply under the provider's post in the channel. Channels can't open Mini Apps from buttons,
 * so Buy is a deep link into the bot (`start=buy_<id>`), which answers with the Mini App button.
 */
export function lockedCard(l: Links, s: PublicSignal, now = Date.now()): Card {
  return {
    text: en.locked({ market: s.market, hours: hoursLeft(s.validUntil, now), priceUsd: usd(s.priceUsd), free: Number(s.priceUsd) === 0 }),
    keyboard: new InlineKeyboard().url(en.buttons.buy, deepLink(l, `buy_${s.id}`)).url(en.buttons.proof, webUrl(l, `/s/${s.id}`)),
  };
}

const signedR = (r: number | null) => (r == null ? "" : `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r).toFixed(1)}R`);

/** ✅ / ❌ card after settlement, for the channel and for each buyer. */
export function resultCard(l: Links, n: SignalNotify): Card {
  const s = n.signal;
  const what = `${s.market.split("/")[0]}${s.side ? ` ${s.side}` : ""}`;
  const buyers = Math.max(1, s.purchaseCount);
  const slash = n.settlement ? BigInt(n.settlement.slashTotal) / BigInt(buyers) : 0n;
  const perSub = slash > 0n ? Number(fromUnits(slash)).toFixed(2) : "";
  const r = signedR(s.rMultiple);
  const expiry = s.tx.resolve != null && s.decidedAt != null && new Date(s.decidedAt) >= new Date(s.validUntil);
  const outcome = n.settlement?.outcome ?? s.outcome;
  let text: string;
  if (s.status === "UNREVEALED_LOSS") text = en.result.unrevealed({ what, perSub });
  else if (outcome === "WIN") text = (expiry ? en.result.expiryWin : en.result.win)({ what, r, at: clock(s.committedAt) });
  else if (outcome === "LOSS") text = (expiry ? en.result.expiryLoss : en.result.loss)({ what, r, perSub });
  else text = en.result.void({ what });
  const links = en.result.links({
    proof: s.tx.resolve ? txUrl(l, s.tx.resolve) : undefined,
    settle: n.settlement?.settleTx ? txUrl(l, n.settlement.settleTx) : undefined,
  });
  return {
    text: links ? `${text}\n${links}` : text,
    keyboard: new InlineKeyboard().url(en.buttons.viewSignal, webUrl(l, `/s/${s.id}`)),
  };
}

/** DM to a buyer once their key is delivered. Plaintext never goes through chat. */
export function unlockedCard(l: Links, s: PublicSignal): Card {
  return { text: en.unlocked(s.market), keyboard: new InlineKeyboard().webApp(en.buttons.open, miniApp(l, `/my?signal=${s.id}`)) };
}

/** Bot answer to `start=buy_<id>` / `/buy <id>`: opens the Mini App purchase screen. */
export function buyCard(l: Links, s: PublicSignal, now = Date.now()): Card {
  return {
    text: en.buyIntro({ market: s.market, priceUsd: usd(s.priceUsd), provider: s.provider?.displayName ?? "unknown", hours: hoursLeft(s.validUntil, now) }),
    keyboard: new InlineKeyboard().webApp(en.buttons.buy, miniApp(l, `/buy/${s.id}`)).url(en.buttons.proof, webUrl(l, `/s/${s.id}`)),
  };
}
