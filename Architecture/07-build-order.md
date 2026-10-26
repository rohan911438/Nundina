# 7. Build order (Oct 26 → Nov 1)

We are two days behind the original plan, so this compresses it. Build the **demo path first**: provider commits → subscriber pays via HSP → oracle settles → win pays / loss refunds → leaderboard updates.

| Day | Date | Build | Done when |
|---|---|---|---|
| D2 | Mon Oct 26 | Monorepo scaffold (pnpm, `packages/shared` with EIP-712 types + addresses). Contracts: ProviderRegistry, SignalBook, PerformanceEscrow (HSP credit + settle + refund + slash). | Fork tests pass for commit → credit → settle (mock outcome) |
| D3 | Tue Oct 27 | OutcomeResolver (APRO + Supra adapters, challenge window), RevenueRouter, ERC-8004 deploy. **Testnet deploy.** api: `PaymentRail` with `MockRail` + `HspRail`. | Full lifecycle on testnet with mock HSP |
| D4 | Wed Oct 28 | bot (detect, parse, confirm, commit, buy, key DM) + Mini App screens (`/tg/connect`, `/tg/confirm`, `/tg/buy`, `/tg/my`) + key service. | A real Telegram post becomes an on-chain commit and a buyer decrypts it |
| D5 | Thu Oct 29 | keeper (Binance WS, Supra proofs, settle, sweeps), indexer, scoring. Web: Home, Leaderboard, Profile, Signal detail. | Signals settle by themselves; leaderboard shows them |
| D6 | Fri Oct 30 | **Mainnet deploy + verify.** Strategy agent + execution agent (SpendGuard). Start/dashboards pages. Switch to live HSP if credentials arrived. | First real mainnet HSP purchases |
| D7 | Sat Oct 31 | Real providers onboarded. Stretch in order: aggregator + RevenueRouter demo, MCP server, KYC badge. Security pass. | 10+ real HSP payments on mainnet |
| D8 | Sun Nov 1 | Demo video, deck, README with addresses and payment IDs. **Submit by 18:00 IST.** | Submitted |

## Parallel split (if 2–4 people)
| Person | D2–D3 | D4–D5 | D6–D8 |
|---|---|---|---|
| Contracts | All contracts + tests | OutcomeResolver hardening, invariants | Mainnet deploy, verify, security pass |
| Backend/HSP | Scaffold, api, PaymentRail | Key service, keeper, indexer | Live HSP, agents |
| Bot/Frontend | Design system, Home + Leaderboard with mock data | Bot + Mini App, Profile + Signal pages | Dashboards, polish |
| Agents/Pitch | Provider outreach, strategy agent | Execution agent, MCP | Deck, video, traction numbers |

## Cut list (cut from the top if late)
1. Shadow leaderboard
2. HSKSwap auto-execution
3. EIP-3009 fast path
4. HSP devkit adapter
5. Pages 9–12 (`/signals`, `/how-it-works`, `/developers`, `/transparency`) (fold key content into Home)
6. KYC badge
7. Aggregator + RevenueRouter demo (keep the contract, drop the live demo)

**Never cut:** commit-reveal, HSP payment + verify + credit, oracle settlement, refund on loss, bond slash, Telegram flow, leaderboard, ERC-8004 feedback, mainnet deploy.
