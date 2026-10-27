# Security model

One page: who we trust, for what, and every power an admin has. Contracts: `ProviderRegistry`, `SignalBook`, `OutcomeResolver` (+ adapters), `PerformanceEscrow`, `RevenueRouter`, `SignerCreditVerifier`, ERC-8004 `IdentityRegistry` / `ReputationRegistry`.

## Trust assumptions
| Party | Trusted for | Not trusted for | If it misbehaves |
|---|---|---|---|
| **Credit signer** (API key, signs `Credit` after `HSPVerifier.verify()` = ACCEPT) | Saying a transfer that reached the escrow belongs to `(signal, subscriber)` | Minting money: a credit needs `balance ≥ liabilities + amount`, every `receiptHash` and `txHash` is single-use | It can attribute an *uncredited, in-flight* transfer to the wrong buyer. It cannot touch credited payments, claimable balances or bonds. Rotate via timelock; replace with an on-chain HSP receipt verifier behind `ICreditVerifier`. |
| **Oracles** (APRO push, Supra push storage, Supra pull proofs) | Prices and timestamps | n/a | Wrong prices mean wrong outcomes. Mitigations: earliest-touch-wins challenge window (10 min), expiry marks held in the same window when touch proofs are on, fallback adapter, staleness limits. See `ORACLES.md`. |
| **Key service** (off-chain) | Confidentiality of signal plaintext before reveal | Funds (it holds none) | Leaks signals early; cannot move money or change outcomes. Future: threshold encryption / TEE. |
| **Relayer** (`RELAYER_ROLE` on SignalBook) | Paying gas for commits | Content: every commit needs the provider's EIP-712/ERC-1271 signature, nonce and deadline | Can refuse to relay (censor); cannot forge or replay commits. |
| **Keeper** (anyone) | Liveness of touch proofs, finalisation, settlement | Correctness: proofs are verified on-chain, counter-proofs override | Inaction only delays; `claimRefund` after 24 h guarantees refunds. |
| **KYC issuer** (HSP attestation key) | The "Verified" badge | Funds | A bad issuer key can badge a provider; it cannot move bonds. |

## Every admin power (holder: `TimelockController`)
| Contract | Power | Bound |
|---|---|---|
| PerformanceEscrow | `setFeeBps` | ≤ 20% of **winning** payments only |
| PerformanceEscrow | `setTreasury` | Only where *future* fees accrue |
| PerformanceEscrow | `setCreditVerifier` | See credit signer row; cannot reach owed funds |
| PerformanceEscrow | `setAllowedToken` | New credits only |
| PerformanceEscrow | `pause` / `unpause` | Blocks **new credits only**; `settle`, `claimRefund`, `withdraw`, `withdrawFor`, `recoverUncredited` are never pausable |
| SignalBook | `pause` / `unpause` | Blocks new commits only |
| SignalBook | `setLimitThresholdBps` (≤ 5%), `setMaxPricePerSub` | Signal admission rules |
| SignalBook | grant/revoke `RELAYER_ROLE` | Who may pay gas for commits |
| OutcomeResolver | `setAdapters` (push, touch verifier, touch flag) | **Most sensitive power**: a malicious adapter could fake outcomes. Timelock delay gives users time to exit (no new buys; `claimRefund`). |
| Oracle adapters | `setFeed` / `setPair` / `setMaxStaleness` | Same as above |
| ProviderRegistry | `setKycIssuer`, `setAllowedToken`, `setDefaultBondToken` | Badge + token allowlist |
| SignerCreditVerifier | `setSigner` | Rotate the credit signer |
| ReputationRegistry | grant/revoke `WRITER_ROLE` | Who writes feedback; settlement never depends on it (`try/catch`) |

**Set-once wiring (cannot be changed after deploy):** `ProviderRegistry.setEscrow`, `SignalBook.setResolver`, `OutcomeResolver.setBook`, `RevenueRouter.setEscrow`.

## There is no admin path to user funds
- Bonds leave `ProviderRegistry` only via `withdrawBond` (to the provider, after 7 days, only unlocked bond) or `slash` (only by the escrow, only **to the escrow**, only from bond locked for an open signal).
- Escrow tokens leave only via `withdraw`/`withdrawFor` (to the owner of a claimable balance) or `recoverUncredited` (to the original payer of an *uncredited* transfer, capped at `balance − liabilities`).
- No `sweep`, no upgradeability, no `delegatecall`.

## Invariants (tested in `test/EscrowInvariants.t.sol`)
- `credited[token] ≤ received[token]` (a credit never exceeds real tokens).
- `balanceOf(escrow) ≥ liabilities`.
- `liabilities == Σ claimable + Σ open pots`.
- Bond locked == Σ (slash × subscribers) over open pots.
- Each `receiptHash` and `txHash` is used once; a pot is either SETTLED or REFUNDED, never both.

## Known limitations
- With `touchProofsEnabled = false`, intrabar touches are invisible: a stop that was hit and recovered can still settle as a WIN at expiry.
- Subscribers who pay **after** the deciding touch (keeper lag) get their payment back but no bond slice (`paidAt < decidedAt` rule), so a known loser can't be bought for profit.
- `maxSubscribers` per signal (hard ceiling `MAX_SUBSCRIBERS = 200`, set to 50 on mainnet via the timelock-only `setMaxSubscribers`) keeps `settle` gas bounded. The API reads the on-chain value.
- `MockPriceAdapter` is for tests/testnet only and must never be wired on mainnet.

## Pre-mainnet review (Prompt 15)
Each item is either fixed with a test or explained.

**Contracts**
| Item | Result |
|---|---|
| Reentrancy on transfer paths | Every external path that moves tokens is `nonReentrant`: escrow `creditPayment`/`fundWithAuthorization`/`settle`/`claimRefund`/`withdraw`/`withdrawFor`/`recoverUncredited`, registry `depositBond`/`withdrawBond`/`slash`, resolver touch/expiry. Pull payments: `settle` only books claims (the router returns splits and moves no tokens); tokens leave in `withdraw`. Test: `test_reentrancyBlocked`. |
| Replay | `receiptHash` and `txHash` are single-use (`test_replayReceipt_reverts`, `test_replayTx_reverts`). Commit nonce + deadline (`test_commit_replayedNonce_reverts`). EIP-3009 nonces are enforced by the token (`test_fundWithAuthorization`). Credit signatures are bound to chainId + verifying contract + every field (`test/CreditDomain.t.sol`, new). |
| Rounding | Fee = `total × feeBps / 10 000`, payout = `total − fee`, so nothing is lost. Router splits send the dust to the aggregator; `testFuzz_conservationAndDust` checks that the totals are conserved. R-multiples are computed off-chain for display only and never move funds. |
| Funds can't get stuck | `claimRefund` works 24 h after expiry in any non-settled state, even when paused (`test_claimRefund_afterDelay_evenWhenPaused`). Pause blocks new credits only (`test_paused_blocksCreditsOnly`). Invariants `solvent` / `liabilitiesAccounted` hold. |
| Admin powers | Every parameter sits behind the timelock (table above); there is no path to user funds. Roles are checked against `Deploy.s.sol` on-chain by `pnpm contracts:check-roles` (`apps/api/scripts/check-roles.ts`: timelock admin, deployer renounced, RELAYER/WRITER/UPDATER roles, set-once wiring, signer, treasury, fee, caps, touch flag). It passes on a local dry-run deploy (`pnpm contracts:check-roles:local`). It must be run again on 177 after the deploy. |
| Oracle staleness / wrong pair | `test_stalePush_reverts`, `test_apro_spot_and_stale`, `test_touch_wrongPair_reverts`. |
| Mainnet caps | `maxPricePerSub` 5 USDT and `maxSubscribers` 50 on chain 177 (`Config.s.sol`), set in `Deploy._wire` before the admin handover. Tests: `test_maxSubscribers_configurable`, `test_commit_priceCap_and_validity`. |

**Slither 0.11** (`slither . --filter-paths "lib|test|script"`). No High findings. Aderyn is not installed on the build machine; it was skipped.
| Finding | Count | Triage |
|---|---|---|
| reentrancy-no-eth (Medium) | 3 | `_credit → registry.lockBond`, `proveTouch → book/touchVerifier`, `settle → router.route`. The callees are our own set-once contracts or a timelocked adapter, and every entry point is `nonReentrant`. Accepted. |
| incorrect-equality (Medium) | 1 | Enum equality (`status == Revealed`), not a balance. False positive. |
| uninitialized-local (Medium) | 7 | Counters and accumulators that rely on the zero default on purpose. Accepted. |
| unused-return (Medium) | 11 | `try` reads of oracle rounds and ERC-8004 feedback, where the ignored fields are unused. Accepted. |
| missing-zero-check (Low) | 7 | Constructor and timelock setters. Deploy and `check-roles` assert the real values. Accepted. |
| calls-loop (Low) | 6 | `settle` loops over subscribers, bounded by `maxSubscribers` (50). Accepted. |
| reentrancy-benign (Low) | 4 | Events after calls into trusted contracts. Accepted. |
| timestamp (Low) | 15 | Expiry, staleness and challenge windows are minutes to hours long, so a few seconds of miner drift doesn't matter. Accepted. |
| Informational | 6 | assembly (OZ-style ECDSA), complexity, unindexed events. No action. |

**Off-chain** (see `apps/api/SECURITY-OPS.md` for the checklist and results).
