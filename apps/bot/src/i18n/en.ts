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
    connectWeb: "Link in the app",
    addToChannel: "➕ Add me to your channel",
    onboarding: "Provider setup",
  },

  // ── account linking (Telegram ↔ wallet)
  connectBot: (url: string) =>
    `<b>Link this Telegram account to your wallet</b>\nOpen the link, sign in with your wallet, and it's done. Then purchases, unlocks and your channel all use the same account.\n\n${esc(url)}\n\nThe link works once and expires in 10 minutes.`,
  connectLinked: (wallet: string) => `✅ Telegram is linked to wallet <code>${esc(wallet)}</code>.`,
  acctLinked: (wallet: string | null) =>
    `✅ <b>Telegram linked</b>${wallet ? ` to wallet <code>${esc(wallet)}</code>` : ""}.\nGo back to the app to continue. Providers: the next step is verifying your channel.`,
  acctBadLink: (why: string) => `⚠️ ${esc(why)}`,

  // ── provider: linking
  linkNotProvider: "You're not registered as a provider yet. Set up your provider profile in the app first.",
  linkNoWallet: (url: string) =>
    `This Telegram account isn't linked to a wallet yet, so I can't tell which provider you are.\n\nOpen provider setup, sign in with your wallet and tap <b>Connect Telegram</b>:\n${esc(url)}`,
  linkSteps: (code: string, bot: string) =>
    `<b>Verify your channel</b>\nTap <b>Add me to your channel</b> below, pick your channel and keep the suggested admin rights. I check with Telegram that you own or admin it, and that's it.\n\nAlready added me as admin? Post this in the channel instead:\n<code>/link ${esc(code)}</code>\n(works once, expires in 15 minutes, I delete it straight away)\n\nOnly the channel's owner or its admins can verify it, and one channel belongs to one provider. Bot: @${esc(bot)}`,
  linkCodeInDm:
    "That code goes in your <b>channel</b>, not here. Easier: tap <b>Add me to your channel</b> and I verify it in one step.",
  linkNeedsAdmin: "I need to be an admin of this channel with the “Post messages” right before it can be linked.",
  linkBadCode: "That link code is invalid or expired. Run /link_channel in a DM with me for a new one.",
  linkAlready: (title: string, members?: number | null) =>
    `Your channel <b>${esc(title)}</b>${members ? ` (${members} subscribers)` : ""} is verified. To switch channels, remove me from this one and add me to the new one.`,

  // ── provider: channel verification
  channelVerifiedPost: (p: { handle: string; url: string }) =>
    `✅ <b>This channel is verified on Nundina</b> as @${esc(p.handle)}.\nSignals posted here are locked on HashKey Chain before the move, and subscribers are refunded when they're wrong.\nTrack record: ${esc(p.url)}`,
  channelVerifiedDm: (p: { title: string; role: string; members?: number | null; url: string }) =>
    `✅ <b>${esc(p.title)}</b> is verified and linked to your profile.\nTelegram confirms you're its ${p.role === "creator" ? "owner" : "admin"}${p.members ? ` · ${p.members} subscribers` : ""}.\n\nPost signals in the channel as usual: I send each one to you here to confirm and lock.\nYour profile: ${esc(p.url)}`,
  channelLookalike: (handle: string) =>
    `⚠️ Your channel's name looks a lot like @${esc(handle)}, who was here first. Your profile shows buyers a lookalike warning. If that's a mistake, rename the channel or contact us.`,
  channelNoProvider: (url: string) =>
    `Thanks for adding me. I couldn't verify the channel yet: your Telegram account isn't linked to a Nundina provider profile.\n\nOpen provider setup, sign in with your wallet and tap <b>Connect Telegram</b>, then add me again (or run /link_channel):\n${esc(url)}`,
  channelNotAdmin: "I couldn't verify that channel: Telegram doesn't list your account as its owner or an admin.",
  channelTaken: (why: string) => `I couldn't verify that channel: ${esc(why)}. Each channel can belong to one provider only.`,
  channelRefused: (why: string) => `I couldn't verify this channel: ${esc(why)}.`,
  channelNeedsPost: (title: string) =>
    `I'm an admin of ${title ? `<b>${esc(title)}</b>` : "your channel"} but without the “Post messages” right. Turn it on so I can verify the channel and post results.`,
  channelDropped: (title: string, why: string) =>
    `⚠️ <b>${esc(title)}</b> is no longer verified on your Nundina profile: ${why}. Add me back as an admin to verify it again.`,
  whyBotRemoved: "I'm no longer an admin who can post there",
  whyOwnerLeft: "your Telegram account is no longer its owner or an admin",

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
