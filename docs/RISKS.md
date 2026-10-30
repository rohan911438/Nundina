# Risks and mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | **Regulation:** treated as investment advice (for example, SEBI's finfluencer rules) | Medium | High | Positioned as **verification and settlement infrastructure**. Nundina doesn't create signals for humans; providers carry their own compliance. Clear disclaimers, no custody of trading capital, a KYC-attested provider tier, and geo-restriction if needed. Legal review before mainnet scale |
| 2 | **HSP credentials arrive late,** or HSP (pre-1.0) changes its format | Happened | High | Payments sit behind a `PaymentRail` interface. The direct rail runs today with HSP-style mandates and on-chain verification; the gateway rail is built and tested against a fake gateway, and switches on with credentials |
| 3 | **Oracle granularity** (APRO push updates on a 0.5% move or a long heartbeat) | Known | Medium | Pull proofs for touches with a challenge window; push prices only at expiry; APRO → Supra fallback; markets limited to verified feeds (BTC/USD, HSK/USD) |
| 4 | **Smart contract bug** loses user funds | Low–Medium | High | Mainnet caps ($5 per buyer, 50 buyers per signal); no admin path to funds; timelocked admin; permissionless refunds; 114 Foundry tests including fuzz and invariants (96.9% line coverage); Slither triaged; internal audit. A professional audit comes before scaling |
| 5 | **Providers don't want public losses** | High (for bad providers) | Medium | That is the point: target honest providers, for whom verification is a growth tool. Practice signals lower the fear; observed profiles create pressure |
| 6 | **A paid signal leaks** to non-buyers | High | Low | Acceptable: every signal is revealed later anyway. The value is timing plus the refund guarantee. Per-buyer watermarking is possible later |
| 7 | **Sybil and gaming** (self-buying, both-sides posting, geometry farming) | Medium | Medium | Bond slash ≥ price, expectancy and Wilson-bound scoring, oracle entry checks, one identity per provider ([anti-gaming table](ARCHITECTURE.md#anti-gaming)) |
| 8 | **The key service is a trust point** (it sees plaintext early) | Known | Low–Medium | Stated openly. It never touches funds. Threshold encryption or a TEE is on the roadmap |
| 9 | **Telegram API or terms** | Medium | Medium | The bot acts only where it is added as admin. Web, MCP and on-chain flows work without Telegram |
| 10 | **Stablecoin liquidity on HashKey** | Medium | Low | Both USDT and USDC supported; small amounts at launch |
| 11 | **Keeper or RPC outage** | Medium | Medium | Exchange feed fallback (Gate behind Binance); keeper catches up after an outage; `/status` monitoring with alerts; anyone can settle or claim a refund |
| 12 | **Free-tier hosting limits** | Medium | Low | Services restart independently under a supervisor; the indexer rebuilds from raw events; paid plans before relying on it past the hackathon |
