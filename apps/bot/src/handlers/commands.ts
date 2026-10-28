import { Composer, InlineKeyboard } from "grammy";
import { ApiError } from "../api.js";
import { buyCard, deepLink, hoursLeft, miniApp, usd, webUrl } from "../cards.js";
import { ONBOARDING_PATH, addToChannelUrl } from "../channels.js";
import type { Ctx, Deps } from "../context.js";
import { en } from "../i18n/en.js";

export const COMMANDS = [
  { command: "signals", description: "Live locked signals" },
  { command: "my", description: "Your purchases" },
  { command: "connect", description: "Link your wallet" },
  { command: "buy", description: "Buy a signal: /buy <id>" },
  { command: "agent", description: "Your trading agent" },
  { command: "link_channel", description: "Providers: connect your channel" },
  { command: "bond", description: "Providers: bond and capacity" },
  { command: "help", description: "Help and disclaimer" },
];

const html = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };

/** Private-chat commands. Every user is registered with the API on first contact. */
export function commandHandlers(deps: Deps) {
  const c = new Composer<Ctx>();
  const pm = c.chatType("private");

  // resolved on every message: linking a wallet moves this Telegram account onto another user row
  pm.use(async (ctx, next) => {
    ctx.session.userId = (await deps.api.user(ctx.from.id, ctx.from.username)).userId;
    await next();
  });

  const onboarding = () => webUrl(deps.links, ONBOARDING_PATH);
  const addKb = (ctx: Ctx) => new InlineKeyboard().url(en.buttons.addToChannel, addToChannelUrl(ctx.me.username));

  async function linkChannel(ctx: Ctx & { from: { id: number; username?: string } }) {
    const u = await deps.api.user(ctx.from.id, ctx.from.username);
    const setup = new InlineKeyboard().url(en.buttons.onboarding, onboarding());
    if (!u.wallet) return ctx.reply(en.linkNoWallet(onboarding()), { ...html, reply_markup: setup });
    if (!u.provider) return ctx.reply(en.linkNotProvider, { reply_markup: setup });
    if (u.provider.channelId) {
      const p = await deps.api.providerForChannel(u.provider.channelId);
      return ctx.reply(en.linkAlready(p?.channelTitle ?? "your channel"), html);
    }
    const { code } = await deps.api.linkCode(u.userId);
    return ctx.reply(en.linkSteps(code, ctx.me.username), { ...html, reply_markup: addKb(ctx) });
  }

  /** `/start acct_<token>`: the app sent this person here to link their Telegram account. */
  async function redeemAccount(ctx: Ctx & { from: { id: number; username?: string } }, token: string) {
    try {
      const r = await deps.api.redeemAccountLink(token, ctx.from.id, ctx.from.username);
      ctx.session.userId = r.userId;
      return ctx.reply(en.acctLinked(r.wallet), html);
    } catch (e) {
      if (e instanceof ApiError && e.status < 500) return ctx.reply(en.acctBadLink(e.message), html);
      throw e;
    }
  }

  async function sendBuy(ctx: Ctx, id: string) {
    const s = /^\d+$/.test(id) ? await deps.api.signal(id) : null;
    if (!s) return ctx.reply(en.notFound);
    const card = buyCard(deps.links, s);
    return ctx.reply(card.text, { ...html, reply_markup: card.keyboard });
  }

  pm.command("start", async (ctx) => {
    const payload = ctx.match.trim();
    if (payload.startsWith("buy_")) return sendBuy(ctx, payload.slice(4));
    if (payload.startsWith("acct_")) return redeemAccount(ctx, payload.slice(5));
    if (payload === "link_channel") return linkChannel(ctx);
    if (payload.startsWith("p_")) {
      const handle = payload.slice(2);
      return ctx.reply(`@${handle}`, { reply_markup: new InlineKeyboard().url(en.buttons.provider, webUrl(deps.links, `/p/${handle}`)) });
    }
    return ctx.reply(en.welcome(ctx.from.first_name), {
      ...html,
      reply_markup: new InlineKeyboard().webApp(en.buttons.connect, miniApp(deps.links, "/connect")),
    });
  });

  pm.command("help", (ctx) => ctx.reply(en.help, html));

  pm.command("connect", async (ctx) => {
    const u = await deps.api.user(ctx.from.id, ctx.from.username);
    const mini = new InlineKeyboard().webApp(en.buttons.connect, miniApp(deps.links, "/connect"));
    if (u.wallet) return ctx.reply(en.connectLinked(u.wallet), { ...html, reply_markup: mini });
    const { token } = await deps.api.startAccountLink(ctx.from.id, ctx.from.username);
    const url = webUrl(deps.links, `/connect?t=${token}`);
    return ctx.reply(en.connectBot(url), { ...html, reply_markup: new InlineKeyboard().url(en.buttons.connectWeb, url).row().webApp(en.buttons.connect, miniApp(deps.links, "/connect")) });
  });

  // `/link CODE` belongs in the channel; people often send it here
  pm.command("link", (ctx) => ctx.reply(en.linkCodeInDm, { ...html, reply_markup: addKb(ctx) }));

  pm.command("buy", (ctx) => sendBuy(ctx, ctx.match.trim().replace(/^#/, "")));

  pm.command("signals", async (ctx) => {
    const { items } = await deps.api.liveSignals();
    const live = items.filter((s) => new Date(s.validUntil).getTime() > Date.now()).slice(0, 8);
    if (!live.length) return ctx.reply(en.noSignals);
    const kb = new InlineKeyboard();
    for (const s of live) kb.url(`#${s.id} ${s.market}`, deepLink(deps.links, `buy_${s.id}`)).row();
    const lines = live.map((s) =>
      en.signalLine({ id: s.id, market: s.market, provider: s.provider?.displayName ?? "?", priceUsd: usd(s.priceUsd), hours: hoursLeft(s.validUntil) }),
    );
    return ctx.reply([en.signalsHeader, ...lines].join("\n"), { ...html, reply_markup: kb });
  });

  pm.command("my", async (ctx) => {
    const me = await deps.api.mySubscriber(ctx.session.userId!);
    if (!me.purchases.length) return ctx.reply(en.myEmpty);
    const lines = me.purchases.slice(0, 10).map((p) => en.myLine({ id: p.signal.id, market: p.signal.market, status: p.status }));
    return ctx.reply([en.myHeader, ...lines].join("\n"), {
      ...html,
      reply_markup: new InlineKeyboard().webApp(en.buttons.myPurchases, miniApp(deps.links, "/my")),
    });
  });

  pm.command("link_channel", (ctx) => linkChannel(ctx));

  pm.command("bond", async (ctx) => {
    const me = await deps.api.myProvider(ctx.session.userId!);
    if (!me) return ctx.reply(en.linkNotProvider);
    const free = (Number(me.bond.totalUsd) - Number(me.bond.lockedUsd)).toFixed(2);
    return ctx.reply(en.bond({ total: me.bond.totalUsd, locked: me.bond.lockedUsd, free }), {
      ...html,
      reply_markup: new InlineKeyboard().url("Manage bond", webUrl(deps.links, "/dashboard/provider")),
    });
  });

  pm.command("agent", async (ctx) => {
    const a = await deps.api.myAgent(ctx.session.userId!);
    if (!a) return ctx.reply(en.agentNone, { reply_markup: new InlineKeyboard().url("Set up", webUrl(deps.links, "/dashboard/agents")) });
    return ctx.reply(en.agentStatus({ status: a.status, spent: a.spentTodayUsd, cap: a.dailyCapUsd }), html);
  });

  return c;
}
