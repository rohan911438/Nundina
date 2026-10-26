# Prompt 04: PerformanceEscrow and RevenueRouter

## Context
Registry, SignalBook and OutcomeResolver exist (prompts 02–03). Read first:
- `Idea/01-idea-and-trust.md` §1.5 Rule 4 (bond math: slash ≥ price)
- `Idea/05-architecture.md` §5.2 `PerformanceEscrow`, `RevenueRouter`, §5.5–5.6
- `Idea/hsp-developer-guide.md` §1, §5, §11 (Mandate, Receipt, adapter signature)
- `Architecture/04-smart-contracts.md`

## Goal
Hold subscriber payments per signal; pay the provider on WIN, refund + bond slice on LOSS, refund without slash on VOID; never let funds get stuck; write ERC-8004 feedback; split aggregator payouts upstream.

## Architecture
```
contracts/src/
├── PerformanceEscrow.sol
├── RevenueRouter.sol
└── lib/ReceiptLib.sol      EIP-712 type for the credit message the API signs
```

## PerformanceEscrow
Constructor wiring: SignalBook, OutcomeResolver, ProviderRegistry, RevenueRouter, ReputationRegistry, treasury, allowed tokens {USDT, USDC.e}.

**Per signal:** `token`, `totalPaid`, `subscribers[]`, `paid[sub]`, `slashPerSub`, `settled`.
**Per token:** `received[token]` (tracked balance), `credited[token]`.

### Funding path 1: HSP-verified credit
`creditPayment(uint256 id, address sub, uint256 amount, bytes32 receiptHash, bytes32 txHash, bytes creditorSig)`
- Caller: anyone; authority comes from `creditorSig`, an EIP-712 `Credit(signalId, subscriber, token, amount, receiptHash, txHash)` signed by the **credit signer** key (our API's key, held only after it ran `HSPVerifier.verify()` and got ACCEPT). Store the credit signer address; rotatable via timelock.
  *Why not verify the HSP adapter signature on-chain?* The HSP receipt format is pre-1.0 and not public yet. Keep on-chain verification as a stretch: put the check behind `ICreditVerifier` so a `HspReceiptVerifier` can replace the signer later without changing escrow.
- `receiptHash` never reused.
- Signal must be committed, not past `validUntil`, not settled, `pricePerSub > 0`, and `amount == pricePerSub`.
- Capacity: `ProviderRegistry.lockBond(provider, slashPerSub)` must succeed for each new subscriber; `slashPerSub = pricePerSub` (rule: slash ≥ price). If bond is insufficient, revert `CapacityFull`.
- **Accounting invariant:** before crediting, sync `received[token] = token.balanceOf(this) − (amounts reserved for other purposes)`; require `credited[token] + amount ≤ received[token]`. A credit can never exceed real tokens.
- One payment per (signal, subscriber).

### Funding path 2: EIP-3009 fast path (USDC.e only)
`fundWithAuthorization(id, from, value, validAfter, validBefore, nonce, v, r, s)`: require `nonce == keccak256(abi.encode(id, from))`; call USDC.e `receiveWithAuthorization` (to = this). Same checks and bond lock as path 1.

### Settlement
`settle(uint256 id)` (anyone, `nonReentrant`):
- Requires `OutcomeResolver.outcomeOf(id).final`.
- **WIN:** `fee = totalPaid * FEE_BPS / 10000` (1000 = 10%) → treasury. Rest → `RevenueRouter.route(id, token, rest)` if upstream exists, else provider payout. Unlock all locked bond.
- **LOSS:** each subscriber gets `paid[sub]` + `slashPerSub` (via `ProviderRegistry.slash(provider, sub, slashPerSub)`).
- **VOID:** refunds only, unlock bond, no slash.
- Write ERC-8004 feedback: `giveFeedback(agentId, score, "nundina", outcome, "", receiptsRootOrZero)` where score = 100 for WIN, 0 for LOSS (VOID: skip). Escrow needs `WRITER_ROLE`.
- Use **pull payments** if subscriber count is large: store `claimable[sub][token]` and expose `withdraw(token)`. For ≤ 50 subscribers you may push; implement pull to be safe and keep `settle` gas bounded.

`claimRefund(uint256 id)`: anyone, when `block.timestamp > validUntil + MAX_SETTLE_DELAY (24h)` and not settled → refund everyone, unlock bond, no slash. **Never pausable**, so funds can never be stuck.

Admin (`TimelockController` only): fee bps (max 2000), treasury, credit signer, pause new credits. Pausing must not block `settle`, `claimRefund` or `withdraw`.

## RevenueRouter
`route(uint256 id, address token, uint256 amount)` (only escrow):
- For each upstream `u` with bps `b`: share = `amount * b / 10000`.
  - If upstream outcome is WIN → share to the upstream provider's payout (recursively route if that upstream itself has upstreams; depth ≤ 3).
  - If upstream lost or was void → share stays with the aggregator (policy: `LOSER_SHARE_TO_AGGREGATOR`; keep it a constant for now).
- Remainder → aggregator provider.
- Rounding dust → aggregator. Sum of all transfers == `amount` exactly.
- Emit `Routed` for each leg.

## Tests
- Full lifecycle with mocks: commit → 3 credits → TP touch → finalize → settle WIN → provider + treasury balances exact.
- LOSS: each subscriber receives price + slash; provider bond reduced by 3 × slash.
- VOID: refunds, no slash.
- Replay `receiptHash` reverts; wrong credit signer reverts; amount ≠ price reverts; credit after expiry reverts; capacity full reverts.
- `credited ≤ received` holds when someone sends tokens directly to the escrow (donations must not be creditable twice).
- `claimRefund` works when paused and after resolver never finalizes.
- Router: 3 upstreams 50/30/20 with one loser; depth-3 chain; dust goes to aggregator; total conserved.
- **Invariant tests** (Foundry `invariant_`): for each token `credited ≤ received`; sum of `claimable` + treasury + payouts == total credited for settled signals; no signal both settled and refunded.
- Reentrancy test with a malicious token mock.

## Done when
- [ ] `forge test` (unit + fuzz + invariant, 10k runs) green.
- [ ] `forge coverage` ≥ 90% for Escrow and Router.
- [ ] A one-page `contracts/SECURITY.md` lists trust assumptions (credit signer, oracle, key service) and every admin power.

## Out of scope
Deploy scripts (05). The API code that signs credits (07).
