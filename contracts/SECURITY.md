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
- `MAX_SUBSCRIBERS = 200` per signal keeps `settle` gas bounded.
- `MockPriceAdapter` is for tests/testnet only and must never be wired on mainnet.
