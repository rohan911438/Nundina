# 9. Risks and Mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | **Regulation:** seen as investment advice or an unregistered advisory (SEBI's finfluencer rules from 2024) | Medium | High | Position it as **verification infrastructure and analytics**. We don't create signals for humans, and providers carry their own compliance. Include clear disclaimers, no custody of trading capital, a KYC-attested provider tier, and geo-restriction if needed. Crypto signals are outside SEBI's securities scope today, but we'd say so carefully and get legal input after the hackathon |
| 2 | **HSP credentials arrive late,** or HSP (pre-1.0) changes its wire format | Medium | High | Ask today. Build against the HSP spec with mock receipts behind an interface, then swap to real ones. Pin the SDK version. Keep receipt parsing in one module |
| 3 | **Oracle granularity:** APRO push has a 1h heartbeat and 0.5% deviation | Known | Medium | Supra pull proofs for touches, with a challenge window. Settlement at expiry uses APRO. MVP markets limited to feeds verified on HashKey (BTC/USD, HSK/USD, plus confirmed Supra pairs) |
| 4 | **Smart contract bug** loses user funds | Low–Medium | High | Small per-signal caps on mainnet; Pausable; no admin path to funds; permissionless `claimRefund`; Foundry fuzz and invariant tests (`credited ≤ balance`); professional audit before scaling |
| 5 | **Providers don't want public losses** | High (for bad providers) | Medium | That's the point: target honest mid-tier providers, for whom verification is a growth tool. The shadow leaderboard creates pressure. A Practice profile lowers the fear |
| 6 | **Paid signal leaked** to non-payers | High | Low | Expected and acceptable, because the signal is revealed later anyway. Value comes from timing and the refund guarantee. Watermarking per subscriber is possible later |
| 7 | **Sybil and gaming** (self-subscribing, both-sides posting, geometry farming) | Medium | Medium | Bond slash ≥ price, minimum R:R, scoring by expectancy and Wilson bound, follower stats weighted by unique KYC'd or bonded wallets (see `05-architecture.md` §5.5) |
| 8 | **Key service is a trust point** (it sees plaintext early) | Known | Low–Medium | Stated openly. It never touches funds. v2 moves to threshold encryption or a TEE |
| 9 | **Telegram API or ToS** (bot limits, reading public channels) | Medium | Medium | Bots act only where added as admin. The shadow scorer reads only public web previews, with opt-out. Web, MCP and on-chain flows work without Telegram |
| 10 | **Stablecoin liquidity on HashKey** (USDC.e is bridged) | Medium | Low | Support both USDT and USDC.e; small demo amounts; ONERWAY off-ramp story for later |
| 11 | **Demo-day failure** (network, oracle delay) | Medium | High | Pre-recorded backup; pre-staged short-expiry signals; testnet mirror |
| 12 | **Scope too big for 8 days** | High | High | Strict must-have list and cut rules (`07-deliverables-and-plan.md`). The aggregator and MCP are the first stretch items |
| 13 | **Similar project at this hackathon** | Low–Medium | Medium | Our depth (HSP receipts verified on-chain, ERC-8004 first deploy, oracle touch proofs, anti-gaming math) and real Telegram providers set us apart |
