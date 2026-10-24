# 1. The Idea and the Trust Design

## 1.1 What it is, in one line
A marketplace where trading signals are **locked on-chain before the move**, **paid for through HSP into escrow**, and **settled by an oracle**. If the call is right the provider gets paid; if it's wrong the subscriber gets refunded.

## 1.2 Who uses it
| User | What they want | What we give them |
|---|---|---|
| **Signal provider** (a human trader, Telegram channel owner, or AI strategy agent) | To prove they're legit, grow VIP sales, and get paid | A free unforgeable track record, a "Verified" badge, and paid signals with automatic settlement |
| **Subscriber** (a retail trader in a Telegram group) | Signals that actually work, and no scams | Refund if wrong, public graded history, and real follower results |
| **Subscriber's execution agent** | To buy signals and optionally execute them within the user's limits | HSP payments with spend caps, an MCP API, and auto-execution on HSKSwap |
| **Aggregator agent** | To buy many signals, blend them, and resell | Upstream signals bought A2A, with revenue automatically routed back to the original providers |

## 1.3 The core loop
```
Provider posts a signal in Telegram ──► Bot parses it ──► Signal committed on HashKey (hash + time)
                                                                    │
Subscriber's agent pays via HSP ──► Escrow holds payment ──► Decryption key delivered to subscriber
                                                                    │
Price hits TP / SL, or expiry ──► Oracle proof ──► Settlement
                                                     ├─ WIN  → provider paid (minus 10% fee)
                                                     └─ LOSS → subscriber refunded + part of provider bond
                                                                    │
Signal revealed publicly ──► Score updated ──► ERC-8004 reputation written on-chain
```

## 1.4 A signal's lifecycle
1. **Draft.** The provider writes the signal as usual in Telegram, e.g. `BTC LONG entry 81,500 TP 84,000 SL 80,200 valid 24h`. The bot parses it, using the Cornix-style format first and an LLM as fallback, and asks for one-tap confirmation.
2. **Commit.** The bot writes `commitHash = keccak256(EIP-712 Signal struct + salt)` to `SignalBook` on HashKey mainnet, along with the market, expiry and price-per-signal. The signal text is encrypted with a fresh per-signal key. **From this second on, the signal can't be changed or deleted.**
3. **Buy.** A subscriber, or their agent, pays through HSP (a Mandate is signed, USDC.e/USDT goes to the escrow, and a Receipt is verified). The bot then sends that subscriber the decryption key, encrypted to their wallet's public key.
4. **Live.** The keeper watches prices. When TP or SL is touched, anyone can submit the oracle price proof.
5. **Settle.** `PerformanceEscrow.settle(signalId)`:
   - A WIN pays the provider.
   - A LOSS refunds every subscriber and slashes part of the provider's bond to them.
   - If neither level is hit by expiry, the outcome is marked to market: the result is a WIN only if the price moved at least 0.5R in the signal's direction, otherwise it is a LOSS.
6. **Reveal.** The plaintext and salt go public on-chain, so anyone can verify the hash. If the provider doesn't reveal within the reveal window, **the signal automatically counts as a loss** and the bond is slashed.
7. **Score.** The profile and leaderboard update, and feedback is written to the **ERC-8004 Reputation Registry**.

## 1.5 The Trust Design: why should a trader believe it?
One lucky call proves nothing, and a trader shouldn't have to trust the provider *or* us. Seven rules handle it.

### Rule 1: You don't need trust, because you get a refund
Payment sits in escrow and comes back automatically if the call is wrong. The first few signals for every new user are covered by a subsidy pool, so their first experience is risk-free.

### Rule 2: Every call counts, so "I was just testing" doesn't exist
- Once a signal is committed it is scored. There is no delete and no edit.
- An unrevealed signal is an automatic loss, which kills the trick of posting 10 contradictory calls and only showing the winners.
- Providers who want to practise get a clearly labelled **Practice profile** that never ranks.

### Rule 3: Separate luck from skill
- **Sample size first.** There is no ranking until a provider has at least 30 settled signals. We show the **Wilson lower bound** of win rate, not raw win rate, so a "3 out of 3" record ranks below "60 out of 100".
- **Expectancy in R** (average gain per unit of risk), not win rate. A tiny take-profit with a huge stop-loss gives a high win rate but bad expectancy, and it shows up.
- **Market-relative alpha.** Every call is compared with simply holding BTC over the same window. If the whole market went up, calling "long" isn't skill.
- **Minimum risk:reward of 1:1** is required to list a signal as pay-if-works, which stops "TP +0.2%, SL −10%" farming.

### Rule 4: Providers put money on the line
- Each provider posts a **bond**. On a LOSS, a slice of it equal to the signal price × number of subscribers goes to the subscribers.
- The math matters here. Let the signal price be `p`, the protocol fee `f`, and the slash per subscriber `s`. A provider posting coin-flip signals has an expected value per subscriber of `0.5·p·(1−f) − 0.5·s`. Setting `s ≥ p` makes **random or "both sides" posting a guaranteed loser**. The provider's subscriber capacity per signal is `bond ÷ s`.
- **Optional:** link a trading wallet and prove you took your own trade, which earns a "Trades own calls" badge.

### Rule 5: Show what followers actually made
Execution agents place real trades, so the profile shows **realized follower results**, e.g. *"212 followed, average +3.1% after fees and slippage"*. It also shows how many people only watched and how many followed.

### Rule 6: Pump-and-dump protection
- **Liquid markets only,** with oracle feeds (BTC, HSK and majors via APRO and Supra). Followers can't move these prices.
- If a provider's linked wallets sell into their own followers' buys during the signal window, the profile is flagged and the bond is slashed through a challenge.

### Rule 7: You don't have to trust us
- Funds are held by the escrow contract, not by the team.
- Results come from the oracle, not from us.
- The scoring code is open source, and anyone can recompute any profile from on-chain data.
- KYC status comes from HSP attestations issued by HashKey's KYC partner, not from us.

## 1.6 The user journey: from watcher to paying user
1. **Watch for free.** Every signal goes public after it settles, so the group sees a graded record grow day by day.
2. **First signals are free or guaranteed,** paid from the subsidy pool.
3. **Pay per signal.** Once a provider has 30+ verified calls, real follower PnL and a bond at stake, the decision is based on data, not screenshots.
4. **Delegate to an agent.** Optionally set a budget, e.g. "max $5/day, only providers with score > 60", and let the execution agent buy and trade automatically.

## 1.7 The A2A layer (the Track 2 core)
- **Provider agents:** three of our own open-source strategy agents (momentum, funding-rate, news-sentiment) post signals from day one.
- **Execution agents** buy signals within user limits using HSP Mandates and the SpendGuard caps from `@hsp/mcp`, then trade on HSKSwap.
- **Aggregator agents** buy from several providers, combine the calls into a meta-signal and commit it with **upstream references and split weights**. When the meta-signal wins, `RevenueRouter` pays the upstream providers automatically, which is multi-hop A2A settlement. Research surveys list this as an open problem.
- **The MCP server** lets any AI agent (Claude, OpenClaw, AgentKit) discover, verify and buy signals using `get_signals`, `verify_track_record` and `buy_signal`.
