/** Every user-facing string. Values are HTML (parse_mode "HTML"); callers escape user text with `esc`. */

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const DISCLAIMER =
  "<i>Signals are opinions, not financial advice. Trading is risky; only pay what you can afford to lose. Refunds follow the on-chain rules shown on each signal.</i>";

export const en = {
  welcome: (name: string) =>
    `Hi ${esc(name)} 👋\n\n<b>Nundina</b> locks trading signals on HashKey Chain before the move. You pay for a signal, and if it's wrong you get refunded plus part of the provider's bond.\n\n/signals live signals · /my your purchases · /connect link your wallet\nProviders: /link_channel\n\n${DISCLAIMER}`,
  help: `<b>Commands</b>
/signals – live locked signals
/buy &lt;id&gt; – buy a signal
/my – your purchases and unlocked signals
/connect – link your wallet (needed to buy)
/agent – your trading agent
<b>Providers</b>
/link_channel – connect your Telegram channel
/bond – your bond and capacity

${DISCLAIMER}`,
  connect: "Open the app to connect your wallet and register your encryption key. Keys for signals you buy are encrypted to it, so only you can read them.",
  buttons: {
    connect: "Connect wallet",
    confirm: "Confirm & lock",
    edit: "Edit",
    ignore: "Ignore",
    buy: "Buy",
    proof: "Proof",
    open: "Open",
    viewSignal: "View signal",
    provider: "Provider profile",
    myPurchases: "My purchases",
  },

  // ── provider: linking
  linkNotProvider: "You're not registered as a provider yet. Register in the app first, then run /link_channel again.",
  linkSteps: (code: string, bot: string) =>
    `<b>Link your channel</b>\n1. Add @${esc(bot)} to your channel as an admin with the <b>Post messages</b> right.\n2. Post this in the channel:\n<code>/link ${esc(code)}</code>\n\nThe code works once and expires in 15 minutes. I delete the message after linking.`,
  linkNeedsAdmin: "I need to be an admin of this channel with the “Post messages” right before it can be linked.",
  linkDone: (title: string) => `✅ Linked <b>${esc(title)}</b>. Signals you post here will be sent to you to confirm and lock.`,
  linkBadCode: "That link code is invalid or expired. Run /link_channel in a DM with me for a new one.",

  // ── provider: drafts
  draft: (p: { channel: string; market: string; side: string; entry: string; tp: string; sl: string; rr: string; hours: number; notes: string[]; parser: string }) =>
    `📝 <b>New signal from ${esc(p.channel)}</b>\n<b>${esc(p.market)} · ${p.side}</b>\nEntry ${esc(p.entry)} · TP ${esc(p.tp)} · SL ${esc(p.sl)}\nR:R ${p.rr} · expires in ${p.hours}h` +
    (p.notes.length ? `\n${p.notes.map((n) => `• ${esc(n)}`).join("\n")}` : "") +
    `\n\nNothing is locked until you confirm. Once locked it can't be edited or deleted.` +
    (p.parser === "llm" ? "\n⚠️ Read by the AI parser: check every number." : ""),
  draftRejected: (why: string) => `⚠️ I couldn't turn your last post into a signal: ${esc(why)}.\nFix the post (or post it again) and I'll try again.`,
  unsupportedMarket: (ticker: string) => `${esc(ticker)} isn't supported yet. Markets today: BTC/USD and HSK/USD.`,
  draftIgnored: "Ignored. Nothing was locked.",
  editedAfterCommit: "🔒 Already locked. Edits don't change the committed signal.",
  editedBeforeCommit: "You edited the post. The draft still has the original text: post the signal again if the numbers changed.",

  // ── cards
  locked: (p: { market: string; hours: number; priceUsd: string; free: boolean }) =>
    `🔒 <b>Locked on HashKey</b> · ${esc(p.market)} · expires ${p.hours}h · ` +
    (p.free ? "free" : `price ${esc(p.priceUsd)} USDT · refund if wrong`),
  lockedProvider: (p: { market: string; url: string }) => `🔒 Your ${esc(p.market)} signal is locked on-chain. <a href="${p.url}">Commit transaction</a>`,
  unlocked: (market: string) => `🔓 <b>Your signal is unlocked</b>\n${esc(market)}: open the app to read it. Keys never travel in chat.`,
  revealReminder: (market: string, closesIn: string) =>
    `⏰ Your ${esc(market)} signal isn't revealed yet. The reveal window closes in ${closesIn}; unrevealed signals count as a loss and slash your bond. Revealing is normally automatic: open the app if it hasn't happened.`,
  result: {
    win: (p: { what: string; r: string; at: string }) => `✅ <b>${p.what} hit TP</b> · ${p.r} · committed ${p.at}, before the move · Provider paid`,
    loss: (p: { what: string; r: string; perSub: string }) => `❌ <b>${p.what} hit SL</b> · ${p.r} · Subscribers refunded${p.perSub ? ` + ${p.perSub} USDT each from bond` : ""}`,
    expiryWin: (p: { what: string; r: string; at: string }) => `✅ <b>${p.what} closed in profit at expiry</b> · ${p.r} · committed ${p.at} · Provider paid`,
    expiryLoss: (p: { what: string; r: string; perSub: string }) => `❌ <b>${p.what} closed at expiry</b> · ${p.r} · Subscribers refunded${p.perSub ? ` + ${p.perSub} USDT each from bond` : ""}`,
    unrevealed: (p: { what: string; perSub: string }) => `❌ <b>${p.what} was never revealed</b> · counts as −1R · Subscribers refunded${p.perSub ? ` + ${p.perSub} USDT each from bond` : ""}`,
    void: (p: { what: string }) => `⚪ <b>${p.what} voided</b> · no reliable price · everyone refunded`,
    links: (p: { proof?: string; settle?: string }) =>
      [p.proof && `<a href="${p.proof}">Proof</a>`, p.settle && `<a href="${p.settle}">Settlement</a>`].filter(Boolean).join(" · "),
  },

  // ── subscriber
  buyIntro: (p: { market: string; priceUsd: string; provider: string; hours: number }) =>
    `🔒 <b>${esc(p.market)}</b> by ${esc(p.provider)}\nPrice ${esc(p.priceUsd)} USDT · expires in ${p.hours}h\nIf it's wrong you're refunded plus part of the provider's bond.`,
  noSignals: "No live signals right now.",
  signalsHeader: "<b>Live signals</b>",
  signalLine: (p: { id: string; market: string; provider: string; priceUsd: string; hours: number }) =>
    `#${p.id} · ${esc(p.market)} · ${esc(p.provider)} · ${esc(p.priceUsd)} USDT · ${p.hours}h left`,
  myEmpty: "You haven't bought any signals yet. /signals",
  myHeader: "<b>Your purchases</b>",
  myLine: (p: { id: string; market: string; status: string }) => `#${p.id} · ${esc(p.market)} · ${esc(p.status.toLowerCase().replace(/_/g, " "))}`,
  notFound: "I couldn't find that signal.",
  agentNone: "You don't have a trading agent yet. Set one up in the app.",
  agentStatus: (p: { status: string; spent: string; cap: string }) => `🤖 Agent: <b>${esc(p.status)}</b> · spent ${esc(p.spent)} of ${esc(p.cap)} USDT today`,
  bond: (p: { total: string; locked: string; free: string }) => `<b>Your bond</b>\nDeposited ${p.total} · locked ${p.locked} · free ${p.free} USDT\nTop up or withdraw in the app.`,
  slowDown: "Slow down a little 🙂",
  error: "Something went wrong. Try again in a minute.",
};
