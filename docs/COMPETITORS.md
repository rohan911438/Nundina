# Competitive landscape

| Product | What it does | How results are verified | How money flows | Gap Nundina fills |
|---|---|---|---|---|
| **Myfxbook** (forex) | Free verified track records | Read-only broker connection | Free for providers; earns from brokers and ads | Forex only, no payments, no refunds. Verifies *accounts*, not individual calls made before the move |
| **Collective2** | Strategy subscription marketplace | Go-forward trade recording | Monthly subscriptions plus provider fees | Flat subscriptions, so buyers pay even when it loses. Centralized, stocks and futures |
| **Cornix** (Telegram) | Auto-trades Telegram signals; marketplace | Backtested statistics | Users pay Cornix; channels sell VIP access separately | Statistics are not live or verifiable, no refunds. Its signal format is the de facto standard, which Nundina reuses for parsing |
| **3Commas and similar** | Bot automation and signal marketplaces | Platform-reported | Subscriptions | Same as Cornix |
| **Exchange copy trading** (Binance, Bitget, Bybit) | Copy a lead trader's positions | Verified by the exchange | Lead trader takes a profit share | Custodial and exchange-locked; reputation is not portable; Telegram providers cannot use it |
| **eToro Popular Investor** | Copy trading | Verified by the broker | Paid on assets under copy | Closed, regulated broker system; not crypto-native |
| **Hyperliquid vaults** | On-chain copy vaults | On-chain PnL | Performance fee | Buyers must hand over capital; covers trades, not signals |
| **Bittensor SN8** | Miners submit trading signals, validators score them | Challenge period, risk-adjusted scoring | TAO emissions | B2B data subnet, requires staking; not a consumer product |
| **Numerai** | Data scientists predict and stake | Scored on live data | Staking rewards | A hedge-fund data tournament, not for retail buyers |
| **Kaito** | Attention leaderboards | Social data | Tokens and SaaS | Measures *attention*, not *accuracy* |
| **Telegram VIP channels** (status quo) | Free channel funnels into a paid VIP channel | Screenshots | Monthly UPI or crypto | No verification, no refunds. **These providers are our users, not our competitors** |

## Positioning

```
                     Verified BEFORE the move
                              ▲
              Nundina ●       │       ● Bittensor SN8
                              │
 Pay per outcome  ◄───────────┼───────────►  Pay flat (subscription / AUM)
 (refund if wrong)            │
   Hyperliquid vaults ●       │   ● Collective2   ● Myfxbook (free)
   (performance fee)          │   ● Exchange copy trading
                              │   ● Cornix (backtested)
                              ▼
                     Self-reported / backtested
```

**Nundina is the only product combining all five:**

1. **Signal-level commitment before the move.** Others verify accounts or trades after the fact.
2. **Per-signal, pay-only-if-right settlement** with automatic refunds.
3. **Non-custodial.** Buyers pay only for information; we never hold trading capital.
4. **Works where providers already are:** Telegram, with no exchange lock-in.
5. **Portable, agent-native reputation:** ERC-8004 identity, an MCP API, and payments agents can make.

## Lessons borrowed

| From | What we took |
|---|---|
| Myfxbook | A free badge providers want to show; the badge becomes the marketing |
| Numerai | Free participation first; money and stake later |
| Bittensor SN8 | A minimum track record before ranking |
| Hyperliquid | Fees on performance only, which crypto users already accept |
| Cornix | Its signal format, for zero-friction parsing |
| Kaito (failure) | Never depend on one platform's rules. The core lives on-chain, and Telegram is one client among several |
