# 6. Status and open questions (as of Mon Oct 26 2026)

## Status
| Area | State |
|---|---|
| Research and product design | ✅ Done (`Idea/`) |
| Detailed architecture | ✅ Done (`Architecture/`) |
| Code | ❌ Not started. Repo has docs only |
| HSP sandbox credentials | ❓ Unknown. Requested? Check the HashKey dev Telegram |
| Mainnet funds (HSK + USDC.e) | ❓ Unknown |
| Real providers lined up | ❓ Unknown (target 3–5) |

**Schedule:** today is D2 of 8. The original plan had D1 (core contracts) done by now. Suggested catch-up:
- Merge D1 + D2 into Oct 26–27 (all contracts + fork tests).
- Keep HSP on Oct 28 with mock receipts if credentials are still missing.
- Cut order if late: shadow leaderboard → HSKSwap execution → EIP-3009 fast path → devkit adapter → aggregator/RevenueRouter (keep MCP; it is cheap).

## Open questions
| # | Question | Who/where to ask | Blocks |
|---|---|---|---|
| Q1 | HSP REPO_URL, COORDINATOR_URL, API_KEY, FAUCET_URL, FACILITATOR_URL | HashKey dev Telegram | All real HSP payments |
| Q2 | Is the HSP Coordinator testnet-only, or does it observe mainnet? | Organizers | Whether real HSP payments can hit mainnet escrow |
| Q3 | Which Supra pair IDs exist on HashKey beyond BTC/USD? | Supra docs / on-chain read | Markets beyond BTC |
| Q4 | Supra pull proof format and verifier call on HashKey | Supra docs | `SupraPullAdapter` |
| Q5 | Is the HSP KYC issuer available to us (and its signing key)? | Organizers | KYC badge (stretch) |
| Q6 | Does HashKey AgentKit support custom tools we need (HSP pay, our contracts)? | `HashkeyHSK/agentkit` repo | Agent wallets |
| Q7 | HSKSwap router address and ABI | HashKey docs | Auto-execution (stretch) |
| Q8 | Has anyone at this hackathon built "signal + escrow"? | DoraHacks gallery | Pitch differentiation |
| Q9 | Legal wording for India (SEBI finfluencer rules) | Post-hackathon legal input | Long-term only |
