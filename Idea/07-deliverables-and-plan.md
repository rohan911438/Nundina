# 7. Deliverables and 8-Day Plan

Today: **Sat Oct 24 2026**. Submission deadline: **Sun Nov 1 2026, 21:30 IST**. The internal target is **18:00 IST** on Nov 1, which leaves a buffer.

## 7.1 What we submit
| # | Deliverable | Done means |
|---|---|---|
| 1 | **Contracts on HashKey mainnet:** SignalBook, PerformanceEscrow, OutcomeResolver, RevenueRouter, ProviderRegistry, ERC-8004 Identity + Reputation | Deployed and **verified on Blockscout**; addresses listed in the README |
| 2 | **Real HSP payments** | At least 10 mainnet signal purchases via HSP with ACCEPT receipts; payment IDs linked in the README |
| 3 | **Telegram bot** (live) | A provider posts, commits and settles; a subscriber buys, decrypts and gets refunded or the provider gets paid |
| 4 | **Web leaderboard and profiles** | Public URL showing scores, signal history with explorer links, and badges |
| 5 | **Agents** | 3 strategy agents posting, 1 execution agent buying under SpendGuard caps, and 1 aggregator agent with multi-hop payout |
| 6 | **MCP server** | `get_signals`, `verify_track_record`, `buy_signal` working from Claude or AgentKit |
| 7 | **GitHub repo** | Open source, README, architecture diagram, setup steps, tests passing (Foundry + TS) |
| 8 | **Demo video** (≤ 3 min) | Follows the script below |
| 9 | **Pitch deck** (8–10 slides) | Problem, demo, how it works, why HashKey, traction, business model, roadmap, team |
| 10 | **Traction evidence** | Number of providers onboarded, signals committed, and payments settled during the hackathon |

## 7.2 Must-have vs stretch goals
**Must-have (MVP):**
- Commit, reveal and auto-loss
- HSP payment, then verify, then credit to escrow
- APRO-based expiry settlement plus Supra touch proof for BTC
- Refund and payout
- Bond slashing
- Telegram bot flows
- Leaderboard
- ERC-8004 deployment with feedback writes
- One strategy agent and one execution agent

**Stretch goals, in order:**
1. Aggregator agent + RevenueRouter multi-hop
2. MCP server with an x402 gate
3. KYC attestation badge (depends on the HSP KYC issuer being available)
4. Shadow leaderboard from public channels
5. HSKSwap auto-execution
6. EIP-3009 fast path
7. A custom HSP devkit adapter

**Cut rules:**
- If HSP credentials haven't arrived by Oct 27, build against the HSP spec using the test Coordinator and mock receipts, then switch to real ones as soon as they arrive.
- If Supra pull isn't usable, settle at expiry only, using APRO.

## 7.3 Day-by-day plan
| Day | Date | Goal | Output |
|---|---|---|---|
| D0 | Sat Oct 24 | Prep | Request HSP sandbox values in Telegram; get HSK + USDC.e; scaffold the repo; freeze this spec |
| D1 | Sun Oct 25 | Core contracts | SignalBook (commit, reveal, auto-loss), ProviderRegistry (bond), PerformanceEscrow skeleton; Foundry tests on a **fork of HashKey mainnet** |
| D2 | Mon Oct 26 | Settlement | OutcomeResolver (APRO adapter + Supra pull adapter + challenge window), settle/refund/slash, `claimRefund` fallback; fuzz tests; **testnet deploy** |
| D3 | Tue Oct 27 | HSP + identity | HSP pay to escrow, Receipt verify, `creditPayment`; ERC-8004 registries deployed; reputation feedback on settle |
| D4 | Wed Oct 28 | Telegram bot | Provider flow (detect, parse, confirm, commit), subscriber flow (buy, ECIES key delivery, decrypt), key service, Cornix parser + LLM fallback |
| D5 | Thu Oct 29 | Keeper, indexer, web | Keeper (touch detection, proofs, settle), Ponder indexer, scoring library, Next.js leaderboard and profiles, badge images |
| D6 | Fri Oct 30 | Agents + **mainnet** | Strategy agent(s), execution agent with SpendGuard, aggregator + RevenueRouter, MCP server; **deploy all contracts to mainnet and verify them**; run the first live signals |
| D7 | Sat Oct 31 | Real users + hardening | Onboard 3–5 real Telegram providers; shadow leaderboard (5–10 public channels); security pass (reentrancy, replay, rounding, pause); fix bugs |
| D8 | Sun Nov 1 | Ship | Record the demo video, finish the deck and README, collect traction numbers, **submit by 18:00 IST** |
| — | Nov 2–4 | Demo Day prep | Rehearse the live demo, keep the bot running, prepare backup recordings |

## 7.4 Demo script (3 minutes)
1. **0:00–0:25, the hook.** Show a news screenshot of a ₹42 lakh Telegram crypto scam. "Signal groups run on screenshots. We made signals impossible to fake and risk-free to buy."
2. **0:25–1:00, the provider.** In a Telegram channel, post "BTC LONG …". The bot asks to confirm, then commits it. Show the Blockscout transaction, timestamped before the move.
3. **1:00–1:40, the subscriber agent.** The execution agent sees the signal, its policy check passes (score > 60, under the $5/day cap), and it pays through HSP. Show the Mandate, the ACCEPT receipt and escrow credited. The signal decrypts in the user's DMs.
4. **1:40–2:20, settlement.** Use a short-expiry signal prepared in advance, plus a losing one. The keeper submits the oracle proof. On the WIN, the provider is paid. On the LOSS, the subscriber is refunded plus the bond slice. Both are shown on-chain.
5. **2:20–2:45, A2A.** The aggregator agent's meta-signal wins and the payout is split automatically to 3 upstream providers. The ERC-8004 reputation updates.
6. **2:45–3:00, close.** The leaderboard shows real providers from the hackathon week. "HSP for payments, KYC badge for trust, HashKey oracles for truth. Pay only when the call is right."

## 7.5 Team split (if 2–4 people)
| Role | Owns |
|---|---|
| Contracts | All Solidity, tests, deploys, verification |
| Backend / HSP | API, HSP integration, key service, keeper, indexer |
| Bot / Frontend | grammY bot, mini app, Next.js web |
| Agents / Pitch | Strategy, execution and aggregator agents, MCP, deck, video, provider outreach |
