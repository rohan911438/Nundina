# Prompt 13: Agents (strategy ×3, execution, aggregator)

## Context
API, payments (07), keeper (10) running on testnet. Read first:
- `Idea/01-idea-and-trust.md` §1.7 (A2A layer)
- `Idea/02-why-this.md` §2.4 (Track 2 fit)
- `Idea/hsp-developer-guide.md` §8 (`@hsp/mcp`, SpendGuard, `skills/hsp-pay`)
- `Architecture/01-how-it-works.md` §1.4, §1.6
- `contracts/src/RevenueRouter.sol`

## Goal
The marketplace has supply from day one (strategy agents), agents buy signals autonomously within user limits (execution agent), and agents buy, blend and resell signals with automatic multi-hop revenue splits (aggregator). This is the Track 2 "A2A settlement" demo.

## Architecture
```
agents/
├── core/                      shared agent runtime
│   ├── wallet.ts              HashKey AgentKit wallet (fallback: viem local account) per agent
│   ├── nundina.ts             typed client for the API (agent API key)
│   ├── pay.ts                 HSP payment via @hsp/mcp tools or @hsp/sdk HSPClient (same PaymentRail shapes as prompt 07)
│   ├── crypto.ts              agent encryption keypair, decrypt purchased signals
│   ├── policy.ts              policy evaluation (pure, unit-tested)
│   └── log.ts                 every decision → POST /agents/:id/activity
├── strategy-momentum/
├── strategy-funding/
├── strategy-sentiment/
├── execution/
└── aggregator/
```
Each agent is its own process (`pnpm --filter agents/<name> start`), registered as a provider or subscriber like any human: ERC-8004 identity, `ProviderRegistry` registration (strategy + aggregator), bond deposit, encryption key.

## Strategy agents (providers)
All post through the same draft → confirm → commit path as humans, signing `CommitAuthorization` with their own wallet. Market: BTC/USD (and HSK/USD if an oracle path is confirmed). Max 6 signals/day each. Price 0.10–0.50 USDT. R:R ≥ 1.5. Validity 2–24 h.
1. **Momentum:** 1h and 4h EMA cross + ATR-based SL (1.5 ATR) and TP (2.5 ATR), Binance klines.
2. **Funding-rate:** extreme perpetual funding (Binance public futures endpoint) → mean-reversion signal; skip when |funding| below threshold.
3. **News-sentiment:** pulls a public crypto news RSS feed, asks Claude (`claude-haiku-5-5`) for a structured sentiment score with reasons; only signals on strong, recent, multi-source sentiment; logs the reasoning in activity.
Keep strategies simple and transparent; the point is honest supply and a demo, not alpha. Each agent's README states its rules, and its profile shows an 🤖 Agent badge.

## Execution agent (subscriber)
Loop every 60 s for each user who created an agent in `/dashboard/agents`:
1. Fetch live signals (`GET /signals?status=live`).
2. `policy.ts` decides: provider score ≥ min, market allowed, provider allowed, price ≤ per-signal cap, today's spend + price ≤ daily budget, not already bought, capacity left. Record **why** for every buy or skip.
3. Pay via HSP: preferred path `@hsp/mcp` `hsp_quote` → `hsp_pay` with **SpendGuard** configured from the same policy (per-tx cap, daily cap, recipient allowlist = escrow only). Fallback: `@hsp/sdk` `HSPClient.pay`. In mock mode, use the API's MockRail flow.
4. Decrypt the signal with the agent's encryption key.
5. Optional (stretch, flag `AUTO_TRADE`): place the trade on HSKSwap with slippage cap; record the fill in `agent_actions.fill_json` → feeds "real follower results". If HSKSwap isn't confirmed, simulate fills from the oracle price and label them simulated.
6. Respect pause instantly (check before every payment).

## Aggregator agent (A2A, multi-hop)
Every 2 h for BTC/USD:
1. Buy the top 3 live signals by provider score (as a subscriber, via the same pay path).
2. Blend: direction = score-weighted vote; entry = current price; TP/SL = weighted average of upstream distances (keep R:R ≥ 1).
3. Commit a meta-signal with `upstream = [ids]` and `upstreamBps` proportional to weight (total 7000 bps; aggregator keeps 3000).
4. Price it above the sum it paid ÷ expected buyers; the execution agent (with a test user) buys it in the demo.
5. On a WIN, `RevenueRouter` pays upstream providers automatically; the aggregator logs the `Routed` events for the demo.

## Safety
- Each agent wallet holds a small balance; a hard cap in code (`MAX_DAILY_SPEND`) in addition to SpendGuard and on-chain price caps.
- Agent private keys only in env/secret manager; never logged.
- Kill switch: env `AGENTS_DISABLED=true` and per-agent pause via API.

## Tests
- `policy.ts`: table tests for every rule and the budget rollover at UTC midnight.
- Strategy functions: deterministic on fixed kline fixtures; always produce valid geometry.
- Aggregator blend: weights, bps sum, R:R ≥ 1.
- Testnet run: 3 strategy agents post, execution agent buys under caps, aggregator meta-signal settles and `Routed` events appear.

## Done when
- [ ] All five agents run for 6 hours on testnet unattended with no policy violations.
- [ ] Activity logs explain every decision.
- [ ] One full aggregator WIN with multi-hop payout visible on the explorer (or a scripted demo signal with short expiry).

## Out of scope
MCP server (14). Sophisticated trading strategies.
