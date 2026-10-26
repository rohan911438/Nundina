# Prompt 02: ERC-8004 registries, ProviderRegistry, SignalBook

## Context
Nundina monorepo exists (prompt 01). Read first:
- `Idea/01-idea-and-trust.md` §1.4–1.5 (lifecycle, trust rules)
- `Idea/05-architecture.md` §5.2
- `Architecture/04-smart-contracts.md`
- `packages/shared/src/eip712.ts` and `test/vectors/signal.json`

## Goal
The identity, bond and commit-reveal layer. After this prompt a provider can register, post a bond, have a signal committed by a gas-sponsoring relayer using their signature, and reveal it. Unrevealed signals can be marked as automatic losses.

## Architecture
```
contracts/
├── src/
│   ├── erc8004/IdentityRegistry.sol      reference ERC-8004 identity (ERC-721 + agent URI)
│   ├── erc8004/ReputationRegistry.sol    reference ERC-8004 reputation (authorized writers)
│   ├── interfaces/ (IProviderRegistry, ISignalBook, IOutcomeResolver, IPerformanceEscrow)
│   ├── ProviderRegistry.sol
│   ├── SignalBook.sol
│   └── lib/SignalLib.sol                 struct, hashing, geometry checks
└── test/ (ProviderRegistry.t.sol, SignalBook.t.sol, utils/Fixtures.sol)
```
Use OpenZeppelin: `EIP712`, `ECDSA`, `SafeERC20`, `AccessControl`, `Pausable`, `ReentrancyGuard`.

## ERC-8004
Port the reference ERC-8004 Identity and Reputation contracts (check the current reference repo/spec; keep the canonical interface and events). If the reference code is not reachable, implement the minimal spec: Identity = ERC-721 where `register(agentURI)` mints an agent id to `msg.sender`; Reputation = `giveFeedback(agentId, score, tag1, tag2, fileURI, fileHash)` callable only by addresses with `WRITER_ROLE`. Note in a comment which reference version you followed.

## ProviderRegistry
State per provider: `agentId`, `payout`, `tgHandleHash`, `bondToken` (one token per provider, USDT or USDC.e, allowlisted), `bondTotal`, `bondLocked`, `withdrawRequestedAt`, `withdrawAmount`, `kycUntil`, `isPractice`.
Functions:
- `register(uint256 agentId, address payout, bytes32 tgHandleHash, bool practice)` requires `IdentityRegistry.ownerOf(agentId) == msg.sender`.
- `depositBond(uint256 amount)` with SafeERC20.
- `requestBondWithdraw(uint256 amount)` / `withdrawBond()`: 7-day delay, and `amount ≤ bondTotal − bondLocked`.
- `lockBond(provider, amount)` / `unlockBond(provider, amount)` / `slash(provider, to, amount)`: `ESCROW_ROLE` only. Slash reduces both total and locked.
- `setKycAttestation(bytes att, bytes sig)`: recover the signer from an EIP-712 `KycAttestation(address subject,uint64 expiresAt)`; must equal `kycIssuer` (settable by admin via timelock). Store `kycUntil`. Real HSP attestation format can be adapted later; keep this isolated.
- `freeBond(provider)` view.
Events per `Architecture/04-smart-contracts.md`.

## SignalBook
State per signal id (auto-increment from 1): `provider`, `commitHash`, `market`, `validUntil`, `pricePerSub`, `committedAt`, `oraclePriceAtCommit`, `upstream[]`, `upstreamBps[]`, `cipherURI`, `revealed`, `status`, plus a `Signal` copy after reveal.

`commit(CommitAuthorization auth, bytes providerSig, uint256[] upstream, uint16[] upstreamBps, string cipherURI) → signalId`
- Callable only by `RELAYER_ROLE` (our API wallet). Verify the provider's EIP-712 signature over `CommitAuthorization`, check `nonce` (per-provider, incrementing) and `deadline`.
- Provider must be registered. Practice providers can commit, but `pricePerSub` must be 0.
- `validUntil` within [now + 15 min, now + 7 days].
- Read the market's current oracle price through `IOutcomeResolver.spotPrice(market)` (stub interface now; implemented in prompt 03) and store it as `oraclePriceAtCommit`.
- Each upstream signal must exist, be committed earlier, and be on the same market; depth of upstream chains ≤ 3.
- Emit `SignalCommitted`.

`reveal(uint256 id, SignalLib.Signal s)`
- `hashSignal(s) == commitHash`, `s.provider == provider`, same market/validUntil/price/upstream.
- Geometry valid and R:R ≥ 1 (else revert: such a signal can never be revealed, so it will become an unrevealed loss, which is intended).
- Entry check: if `|entry − oraclePriceAtCommit| / oraclePriceAtCommit > 0.5%`, mark the signal `isLimit = true` (only goes live once entry is touched; the resolver handles it).
- Anyone may call `reveal` (the API normally does); the resolver can also reveal during resolution (prompt 03 calls an internal `revealFor` restricted to `RESOLVER_ROLE`).

`markUnrevealed(uint256 id)`: anyone, once `block.timestamp > validUntil + REVEAL_WINDOW (6h)` and still not revealed → status `UNREVEALED_LOSS`, emit event. Escrow (prompt 04) reads this status.

Views: `getSignal(id)`, `isRevealed(id)`, `statusOf(id)`, `upstreamOf(id)`.

## Tests (Foundry, run with `--fork-url $HSK_RPC_URL` where oracle reads are needed; a mock resolver is fine here)
- Solidity `hashSignal` equals the golden vector from `packages/shared/test/vectors/signal.json`.
- Commit with a valid signature works; wrong signer, replayed nonce, expired deadline, non-relayer caller all revert.
- Reveal with wrong salt reverts; correct reveal stores the struct; R:R < 1 reverts.
- Entry > 0.5% away sets `isLimit`.
- `markUnrevealed` before window reverts, after window works, twice reverts.
- Bond: deposit, lock, withdraw delay, cannot withdraw locked, slash moves tokens.
- KYC attestation from wrong issuer reverts.
- Fuzz: random valid signals always round-trip commit → reveal.

## Done when
- [ ] `forge test` green, coverage on these contracts ≥ 90% lines.
- [ ] No function lets an admin move a provider's bond to an arbitrary address.
- [ ] `forge fmt` clean; NatSpec on every external function.

## Out of scope
Payments, outcomes, settlement (prompts 03–04). Deployment (prompt 05).
