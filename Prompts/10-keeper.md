# Prompt 10: Keeper (prices, touch proofs, settlement, sweeps)

## Context
Resolver + escrow on testnet (03–05), key service reveal material (07), indexer (08). Read first:
- `Idea/04-why-hashkey.md` §4.3 oracle caveat
- `Idea/05-architecture.md` §5.2 `OutcomeResolver`, §5.3 keeper
- `Architecture/03-backend.md` §3.4 jobs
- `contracts/ORACLES.md` (from prompt 03)

## Goal
Every signal reaches a final, on-chain outcome and gets settled without human action, and no money is ever left stuck.

## Architecture
```
apps/keeper/
├── src/
│   ├── index.ts              starts loops, health server on :8790
│   ├── env.ts
│   ├── state.ts              loads live signals (+ plaintext via internal API) into memory
│   ├── feeds/binance.ts      WebSocket kline/aggTrade streams per market, auto-reconnect
│   ├── feeds/apro.ts         reads APRO rounds (for expiry + round id hints)
│   ├── proofs/supra.ts       fetch Supra pull proof for (pair, timestamp)
│   ├── detectors/touch.ts    crossing detection per signal (entry for limit, TP, SL)
│   ├── actions/              proveTouch, finalize, resolveAtExpiry, settle, markUnrevealed, claimRefund
│   ├── tx.ts                 keeper wallet, nonce manager, retry, gas cap
│   └── metrics.ts            counters + last-run timestamps for /health
└── test/
```

## Loops
1. **Touch watcher (real time).** Binance `btcusdt@aggTrade` (and others as markets are added). For each live, revealed-to-keeper signal, check crossings: limit entry first, then TP/SL in direction. Binance is only a **trigger**; truth comes from the oracle proof.
   On a crossing: fetch a Supra pull proof for the nearest timestamp ≥ crossing time; check the proof's price really crosses the level (Supra and Binance can differ slightly; if not crossed, retry next proof for up to 2 minutes, then drop); send `proveTouch(id, signal, level, proof)`.
   If `touchProofsEnabled` is false on-chain, skip this loop.
2. **Finalizer (every 30 s).** Signals with a pending touch older than the challenge window → `finalize(id)`.
3. **Expiry resolver (every 60 s).** Signals past `validUntil` with no pending touch → find APRO round id hint for `validUntil` → `resolveAtExpiry(id, signal, hint)`.
4. **Settler (every 30 s).** Final outcome and not settled → `PerformanceEscrow.settle(id)`.
5. **Unrevealed sweep (every 10 min).** Committed but never revealed past `validUntil + 6h` → `markUnrevealed` → then settle. (Should be rare since the keeper reveals during resolution; it covers keeper downtime or lost plaintext.)
6. **Refund sweep (every 10 min).** Unsettled past `validUntil + 24h` → `claimRefund`.
7. **Challenge watcher.** When anyone else's `TouchProven` appears (from indexer), check whether an *earlier* touch of the other level exists in our price history; if yes, submit the earlier proof.

## Getting plaintext
The keeper calls the API's internal `GET /internal/signals/:id/reveal-material` (internal secret, keeper only). Keep plaintext in memory only; never write to disk or logs.

## Reliability
- Idempotent: before each action, read on-chain state; skip if already done.
- On restart, rebuild state from DB + chain; no lost work.
- Price-history buffer (last 7 days per market, 1-second resolution from Binance trades aggregated) to answer "did the other level touch earlier?".
- Separate keeper wallet funded with HSK; alert (log + `/health` red) when balance < 5 HSK.
- Gas cap per tx; exponential backoff on RPC errors; circuit breaker if RPC down > 2 min.

## Tests
- Detector unit tests: LONG/SHORT, limit entry then TP, gap through both levels in one tick (SL wins if the first price after commit is beyond SL; document the rule: use the first proof-backed crossing).
- Integration on anvil with `MockPriceAdapter`: drive prices → watch keeper submit proveTouch → finalize → settle; assert balances.
- Restart in the middle of a challenge window → still finalizes.
- Supra proof fetch mocked with fixtures matching the real format documented in prompt 03.

## Done when
- [ ] On testnet, a 30-minute BTC signal resolves and settles with no manual step (TP or SL, or expiry).
- [ ] `/health` shows each loop's last run and keeper balance.
- [ ] A forced keeper outage of 30 min recovers and catches up.

## Out of scope
Agents (13). Any off-chain price as source of truth.
