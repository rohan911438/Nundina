import { Composer, InlineKeyboard } from "grammy";
import { buyCard, deepLink, hoursLeft, miniApp, usd, webUrl } from "../cards.js";
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

  pm.use(async (ctx, next) => {
    if (!ctx.session.userId) ctx.session.userId = (await deps.api.user(ctx.from.id, ctx.from.username)).userId;
    await next();
  });

  async function sendBuy(ctx: Ctx, id: string) {
    const s = /^\d+$/.test(id) ? await deps.api.signal(id) : null;
    if (!s) return ctx.reply(en.notFound);
    const card = buyCard(deps.links, s);
    return ctx.reply(card.text, { ...html, reply_markup: card.keyboard });
  }

  pm.command("start", async (ctx) => {
    const payload = ctx.match.trim();
    if (payload.startsWith("buy_")) return sendBuy(ctx, payload.slice(4));
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

  pm.command("connect", (ctx) =>
    ctx.reply(en.connect, { reply_markup: new InlineKeyboard().webApp(en.buttons.connect, miniApp(deps.links, "/connect")) }),
  );

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

  pm.command("link_channel", async (ctx) => {
    const u = await deps.api.user(ctx.from.id, ctx.from.username);
    if (!u.provider) return ctx.reply(en.linkNotProvider);
    const { code } = await deps.api.linkCode(u.userId);
    return ctx.reply(en.linkSteps(code, ctx.me.username), html);
  });

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
    if (!a) return ctx.reply(en.agentNone, { reply_markup: new InlineKeyboard().url("Set up", webUrl(deps.links, "/dashboard/agent")) });
    return ctx.reply(en.agentStatus({ status: a.status, spent: a.spentTodayUsd, cap: a.dailyCapUsd }), html);
  });

  return c;
}
