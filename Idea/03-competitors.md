# 3. Competitors

## 3.1 The landscape
| Product | What it does | How results are verified | How money flows | Weakness we exploit |
|---|---|---|---|---|
| **Myfxbook** (forex) | Free verified track records | Connects to the broker with a read-only investor password and matches its history against broker records | Free for providers; earns from brokers and ads | Forex only, no payments, no refunds. Verifies *accounts*, not individual signals made before the move |
| **Collective2** | Strategy subscription marketplace | Records trades on a go-forward basis; no backtests allowed | Monthly subscriptions; charges providers fees (users report $99/mo or $100 per 6 months without subscribers) | Flat subscriptions, so you pay even when it loses. Providers pay to build a record. Stocks and futures focus, centralized |
| **Cornix** (Telegram) | Bot that auto-trades Telegram signals on exchanges, plus a marketplace | **Backtested** stats ($10k base, $500 per trade) | Users pay Cornix; channels sell VIP separately | Stats can't be verified live, no refunds, centralized. Its signal format is the de facto standard, which we reuse for parsing |
| **3Commas and similar bots** | Bot automation and signal marketplaces | Platform-reported | Subscriptions | Same as Cornix |
| **Binance / Bitget / Bybit copy trading** | Copy a lead trader's positions | Verified by the exchange | Lead trader gets about 10% profit share | Custodial and exchange-locked. Reputation can't move between platforms. Telegram providers who post signals can't use it. KYC lives inside the exchange |
| **eToro Popular Investor** | Copy trading and investor program | Verified by the broker | Paid up to 1.5%/yr of assets under copy | Regulated broker, closed system, not crypto-native, not usable by Telegram providers |
| **Hyperliquid vaults** | On-chain copy vaults | On-chain PnL | 10% performance fee | You must give the leader your capital and trade on Hyperliquid. Many vaults lose heavily (−49%, −89% lifetime). Covers trades, not signals |
| **Bittensor SN8 (Taoshi PTN)** | Miners submit trading signals and validators score them | 60-day challenge, risk-adjusted scoring | TAO emissions and signal sales | A B2B data subnet, not a consumer product, and it requires TAO staking. Its probation-period idea is worth borrowing |
| **Numerai** | Data scientists predict and stake | Scored on live data | Staking rewards and burns | A hedge-fund data tournament, not for retail signal buyers. Its "free first, stake later" model is worth borrowing |
| **Kaito** | Attention and mindshare leaderboards | Social data | Token rewards and SaaS | Measures *attention*, not *accuracy*. The leaderboard died when X banned pay-to-post |
| **Telegram VIP channels** (the status quo) | Free channel funnels into a paid VIP channel | Screenshots | Monthly UPI or crypto payments | No verification, no refunds, rampant scams. **These are our users, not our competitors** |

## 3.2 Our position
```
                     Verified BEFORE the move
                              ▲
              Nundina  │   Bittensor SN8
                     ●        │       ●
                              │
 Pay per outcome  ◄───────────┼───────────►  Pay flat (subscription / AUM)
 (refund if wrong)            │
          Hyperliquid vaults  │   Collective2 ●   Myfxbook ● (free)
          (perf fee) ●        │   Exchange copy-trading ●
                              │   Cornix ● (backtested)
                              ▼
                     Self-reported / backtested
```

**We are the only one combining all five of these:**
1. **Signal-level commitment before the move.** Others verify accounts or trades after the fact.
2. **Per-signal, pay-only-if-right settlement** with automatic refunds.
3. **Non-custodial.** We never hold a subscriber's trading capital; they only pay for information.
4. **Works where providers already are:** Telegram, with no exchange lock-in.
5. **Portable, agent-native reputation:** ERC-8004, an MCP API, and HSP payments that agents can use.

## 3.3 Lessons borrowed
| From | We borrow |
|---|---|
| Myfxbook | A free badge that providers want to show off; the badge becomes the marketing |
| Numerai | Free to participate first; money and stake later |
| Bittensor SN8 | A probation period before getting paid (30 days or 50 signals) |
| Hyperliquid | Fees on performance only, which crypto users already accept |
| Cornix | Its signal format for zero-friction parsing |
| Kaito (failure) | Never depend on one platform's API rules. The core lives on-chain |

## 3.4 Open check before the pitch
Search DoraHacks and other hackathon galleries for "signal + escrow" builds from 2025–2026 so we can say clearly how we differ. Nothing similar appears among past HashKey winners (see `10-research-archive.md`).
