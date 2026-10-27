# 6. Status and open questions (as of Tue Oct 27 2026)

## Status
| Area | State |
|---|---|
| Research, product design, architecture | ✅ Done (`Idea/`, `Architecture/`) |
| Contracts | ✅ 112 Foundry tests, Slither triaged (`contracts/SECURITY.md`), mainnet caps set, local deploy. ❌ Testnet/mainnet not deployed (no funded deployer) |
| API, bot, keeper, indexer | ✅ Tested on anvil with mock HSP; rate limits, `/status` monitoring and alerts |
| Web + Mini App | ✅ Public pages, dashboards, wallet e2e (Playwright) |
| Agents + MCP | ✅ 3 strategies, execution, aggregator A2A (local WIN with payouts), MCP server |
| CI | ✅ `.github/workflows/ci.yml` (first run happens on push) |
| HSP credentials | ❌ Not received. Mock rail in use (NEEDS #7) |
| Mainnet funds, hosting, alerts chat | ❌ NEEDS #21–23 |
| Real providers / traction | ❌ Not started (NEEDS #24, `TRACTION.md`) |
| Video, deck, submission | ❌ Runbook and outline ready (`docs/DEMO.md`, `docs/PITCH.md`); NEEDS #25–26 |

**What shipped vs the plan.** Everything in the plan was built. Not live yet: HSKSwap execution (fills simulated, NEEDS #19), `@hsp/sdk`/`@hsp/mcp` (hand-rolled equivalents, NEEDS #18), Supra pull touch proofs (off until the proof API is confirmed, NEEDS #3), KYC badge issuer (Q5).

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
| Q10 | Providers "keep posting in their channel": if that channel is public, the plaintext is public before anyone buys. Should the bot delete the raw post after locking (needs the delete right), or do providers post in a private staging channel? | Product decision | Paid signals from public channels |
