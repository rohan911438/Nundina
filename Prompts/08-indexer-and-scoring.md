# Prompt 08: Indexer (Ponder) and the scoring engine

## Context
Contracts on testnet (05), API and DB (06). Read first:
- `Idea/01-idea-and-trust.md` §1.5 Rules 3 and 5 (skill vs luck, follower results)
- `Idea/05-architecture.md` §5.3 indexer + scoring, §5.5 anti-gaming
- `Architecture/03-backend.md` §3.3 tables

## Goal
Every on-chain event lands in Postgres within seconds, and every provider has an open-source, recomputable score.

## Architecture
```
apps/indexer/
├── ponder.config.ts       HashKey testnet + mainnet networks, contracts from packages/shared, start blocks
├── ponder.schema.ts       raw event tables (onchain_*)
├── src/index.ts           handlers
└── src/sync.ts            projects raw events into the API tables
packages/shared/src/scoring/
├── wilson.ts
├── expectancy.ts
├── alpha.ts
├── drawdown.ts
├── score.ts               combines into one 0–100 score
└── __tests__/
apps/api/src/jobs/scoring.ts   recompute job (after each settlement + hourly)
```

## Indexer
Index these events: `ProviderRegistered, BondDeposited, BondSlashed, KycSet` (Registry), `SignalCommitted, SignalRevealed, SignalUnrevealed` (SignalBook), `TouchProven, Resolved` (Resolver), `PaymentCredited, Settled, Refunded` (Escrow), `Routed` (Router), ERC-8004 `Registered`, `NewFeedback` (use the actual event names from the contracts).

Projection rules (`sync.ts`), idempotent by `(txHash, logIndex)`:
- `SignalCommitted` → upsert `signals` (status COMMITTED). If the API already inserted the row, just fill block/tx fields.
- `SignalRevealed` → fill entry/TP/SL/side; status REVEALED.
- `TouchProven` → store touch; `Resolved` → `outcome`, `r_multiple`.
- `PaymentCredited` → purchase `CREDITED` (match by signalId + subscriber).
- `Settled` → `settlements` row; signal status SETTLED; enqueue `scoring.recompute(providerId)` and `notify.result(signalId)` via pg-boss (the indexer writes to the pg-boss table or calls `POST /internal/events`; pick one and document).
- Handle reorgs: Ponder handles raw tables; projections must be recomputable (`pnpm --filter indexer reproject` rebuilds API projections from raw tables).

Expose Ponder's GraphQL on an internal port only.

## Scoring (pure functions in `packages/shared`, used by API and by anyone who wants to recompute)
Inputs: a provider's settled signals `{ outcome, rMultiple, committedAt, validUntil, market, entry, exitPrice }` and BTC prices at commit/exit.
- **Wilson lower bound** of win rate, z = 1.96.
- **Expectancy** = mean R-multiple (LOSS = −1R, unrevealed = −1R, VOID excluded).
- **Alpha vs BTC** = mean over signals of (signal return in direction) − (BTC buy-and-hold return over the same window), in %.
- **Max drawdown** on cumulative R.
- **Sample size** n; `probation = n < 30`.
- **Follower PnL** (from `agent_actions.fill_json` when available): mean realized % after fees.
- **Score 0–100** = weighted: 40% Wilson LB (scaled), 30% expectancy (clamped −1R..+2R), 20% alpha (clamped −5%..+5%), 10% drawdown penalty. Below 30 signals: no score, show "Probation". Document the formula in `packages/shared/src/scoring/README.md` so it is auditable.
- Periods: 7d, 30d, all → `provider_scores`.

## Tests
- Wilson: 3/3 ranks below 60/100; 0/0 returns 0.
- Expectancy with mixed wins and losses matches a hand-computed example.
- Alpha: a LONG in a market that went up the same amount has ~0 alpha.
- Score monotonic: improving any input never lowers the score.
- Indexer: run against a local anvil with prompt 05's smoke script; assert DB rows.

## Done when
- [ ] Committing, buying and settling on testnet shows up in `signals`, `purchases`, `settlements` within 10 s.
- [ ] Scores recompute after each settlement; `/providers` returns them.
- [ ] `reproject` rebuilds the same state from scratch.

## Out of scope
Shadow leaderboard scraping (stretch; only create the tables).
