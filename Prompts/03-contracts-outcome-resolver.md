# Prompt 03: OutcomeResolver with APRO and Supra adapters

## Context
`ProviderRegistry` and `SignalBook` exist (prompt 02). Read first:
- `Idea/04-why-hashkey.md` §4.3 (oracle addresses and the coarse-APRO caveat)
- `Idea/05-architecture.md` §5.2 `OutcomeResolver`
- `Architecture/04-smart-contracts.md` §4.2–4.4
- `contracts/src/SignalBook.sol`

## Goal
Decide every signal's outcome from on-chain oracle data, without trusting the keeper. Output: `WIN` or `LOSS` plus an R-multiple, final after a challenge window.

## Key design point (read carefully)
TP and SL are secret until reveal. So **every resolution call carries the plaintext `Signal`** and the resolver reveals it in the same transaction via `SignalBook.revealFor`. Resolution therefore doubles as reveal. A separate `reveal` stays available for the provider/API.

## Architecture
```
contracts/src/
├── OutcomeResolver.sol
├── oracles/IPriceAdapter.sol        spotPrice(market) → (price8, updatedAt)
├── oracles/AproPushAdapter.sol      Chainlink-style latestRoundData / getRoundData
├── oracles/SupraPullAdapter.sol     verifies a pull proof → (pairId, price, timestamp)
└── oracles/MockPriceAdapter.sol     tests only
```

## AproPushAdapter
- `feeds[market] = aggregator address` (admin-set via timelock).
- `spotPrice(market)`: `latestRoundData()`, normalise to 8 decimals, revert if `updatedAt` older than 2 h (heartbeat 1 h + margin).
- `priceAt(market, ts, roundIdHint)`: return the round whose `updatedAt ≤ ts` and whose next round is `> ts` (caller supplies a round id hint; contract checks both neighbouring rounds). Used for expiry pricing.

## SupraPullAdapter
- Check the Supra pull oracle docs for HashKey: the verifier function on `0x16f7…C3dD`, the proof bytes format, and the returned struct (pair, price, decimals, timestamp). Write a thin interface `ISupraPull` matching it.
- `verifyTouch(bytes proof) → (uint256 pairId, uint256 price8, uint64 ts)`.
- `pairOf[market]` mapping (BTC/USD = 0).
- **If you can't confirm the Supra interface**, implement the adapter against your best reading of the docs behind `IPriceAdapter`, keep `MockPriceAdapter` for tests, and add a feature flag `touchProofsEnabled`. With it off, everything resolves at expiry via APRO (this is the agreed cut rule).

## OutcomeResolver
State per signal: `outcome (NONE/WIN/LOSS)`, `rX100` (R-multiple × 100, signed), `pendingLevel`, `pendingTs`, `pendingAt`, `final`.

`proveTouch(uint256 id, Signal s, uint8 level /*0=TP,1=SL*/, bytes proof)`
1. If not yet revealed, `SignalBook.revealFor(id, s)` (checks hash). If revealed, `s` must match stored.
2. Verify proof via Supra; pair must match the market; `committedAt ≤ ts ≤ validUntil`.
3. If the signal is a limit signal and the entry hasn't been proven touched, revert unless `level == ENTRY` (add `ENTRY = 2`; record `entryTouchedAt`). TP/SL proofs for limit signals require `ts > entryTouchedAt`.
4. Price must cross the level in the correct direction (LONG TP: price ≥ TP; LONG SL: price ≤ SL; mirrored for SHORT).
5. If no pending touch, store it as pending. If a pending touch exists and this one is **earlier**, replace it (that is the challenge). Later touches are ignored.
6. Emit `TouchProven`.

`finalize(uint256 id)`: after `CHALLENGE_WINDOW` (10 min) since the pending touch was recorded → TP = WIN with `rX100 = |TP−entry|*100/|entry−SL|`; SL = LOSS with `rX100 = −100`. Set `final`.

`resolveAtExpiry(uint256 id, Signal s, uint80 roundIdHint)`: after `validUntil`, if no pending touch. Reveal if needed. Expiry price from APRO `priceAt(validUntil)`. Move in the signal's direction `≥ 0.5R` → WIN, else LOSS, with `rX100 = move*100/risk` (can be negative). Limit signals whose entry never touched → outcome `VOID` (add it: escrow refunds without slashing).

`outcomeOf(id) → (Outcome, int256 rX100, bool final)`.
`spotPrice(market)` → delegates to the APRO adapter (used by `SignalBook.commit`).

If the signal is `UNREVEALED_LOSS` in SignalBook, `outcomeOf` returns `(LOSS, -100, true)`.

## Tests
Unit tests with `MockPriceAdapter`, plus a **fork test** reading the real APRO BTC/USD feed on HashKey mainnet:
- TP touch → WIN after window; SL touch → LOSS; before window `final == false`.
- Earlier SL proof submitted after a TP proof overrides it (challenge).
- Proof outside `[committedAt, validUntil]` reverts; wrong pair reverts; level not crossed reverts.
- Expiry: +0.6R → WIN, +0.4R → LOSS, −0.3R → LOSS with negative rX100.
- Limit signal: TP proof before entry touch reverts; never touched → VOID.
- Stale APRO (> 2 h) reverts.
- Fuzz the R-multiple math for both sides; no overflow; sign correct.

## Done when
- [ ] `forge test` green including the fork test against `0x204E…360F`.
- [ ] A short `contracts/ORACLES.md` explains exactly what was confirmed about Supra and what is still assumed.
- [ ] `touchProofsEnabled = false` path fully works on its own.

## Out of scope
Money movement (prompt 04). Off-chain price watching (prompt 10).
