# Prompt 07: Payments (HSP, mock + live) and the key service

## Context
API foundation (06) and testnet contracts (05) exist. Read first:
- `Idea/hsp-developer-guide.md` (all of it)
- `Idea/05-architecture.md` §5.2 `PerformanceEscrow` funding paths, §5.3 key service, §5.6 trust assumptions
- `Architecture/01-how-it-works.md` §1.3–1.4
- `Architecture/05-external-integrations.md` §5.1
- `contracts/src/PerformanceEscrow.sol` (`creditPayment`, `Credit` EIP-712 type)

## Goal
A subscriber (human wallet or agent) can pay for a signal through HSP into `PerformanceEscrow`, the API verifies the HSP receipt independently, credits the escrow on-chain, and delivers the signal's decryption key only to that buyer.

## Architecture
```
apps/api/src/
├── payments/
│   ├── PaymentRail.ts        interface (below)
│   ├── HspRail.ts            real: @hsp/sdk HSPClient + HSPVerifier
│   ├── MockRail.ts           fake Coordinator: signs receipts with a local key, same shapes
│   ├── index.ts              picks rail by HSP_MODE=mock|live
│   └── creditSigner.ts       signs EIP-712 Credit for the escrow
├── keys/
│   ├── keyService.ts         encryptSignal, wrapKeyFor, revealMaterial
│   └── masterKey.ts          envelope encryption of per-signal keys at rest
├── routes/purchases.ts
└── jobs/hspRetry.ts
```

## PaymentRail interface
```ts
interface PaymentRail {
  createIntent(p: { signalId: bigint; payer: Address; token: Address; amount: bigint;
                    compliance?: ('kyc'|'sanctions')[] }): Promise<{ intentId: string;
                    mandateTypedData: TypedData; payee: Address; reference: Hex }>;
  submit(p: { intentId: string; mandateSig: Hex; txHash: Hex }): Promise<{ paymentId: string }>;
  verify(paymentId: string): Promise<{ outcomeClass: 'ACCEPT'|'RETRYABLE'|'POLICY'|'PERMANENT';
                    receiptHash: Hex; amount: bigint; payer: Address; payee: Address;
                    token: Address; txHash: Hex; explorerUrl?: string }>;
}
```
- `payee` is always the escrow address; `reference = keccak256(abi.encode(signalId, payer))`.
- **HspRail:** build the mandate with `@hsp/sdk`; when the payer is a browser wallet the frontend signs (`eip1193` signer) and broadcasts the transfer; the API only registers and observes. Pin the adapter address from `GET <COORDINATOR_URL>/chains` at boot and verify locally with `HSPVerifier.verify(mandate, receipt, attestations)`. Never trust the Coordinator's status field alone.
- **MockRail:** stores mandates in Postgres, checks the ERC-20 `Transfer` log in `txHash` (to = escrow, amount, from = payer) via viem, then issues a receipt signed by `MOCK_ADAPTER_KEY`. Same outcome classes. This lets the whole product run before HSP credentials arrive.
- The HSP SDK is distributed as a repo (not npm). If it isn't available yet, write `HspRail` against the guide's documented API and keep it behind the interface; leave `TODO(hsp-live)` markers only where the real package is needed.

## Purchase flow endpoints
1. `POST /purchases` `{ signalId, token }` (auth: SIWE, Telegram, or agent API key)
   - Checks: signal `COMMITTED`/live, before `validUntil`, buyer ≠ provider, not already bought, provider bond capacity (`ProviderRegistry.capacity`) > current buyers, buyer has a registered ECIES public key (see Keys).
   - Returns `{ purchaseId, intent }`. Status `PENDING`.
2. `POST /purchases/:id/submit` `{ mandateSig, txHash }` (idempotency key header required)
   - `rail.submit` → status `SUBMITTED` → enqueue `hsp.verify` job.
3. Job `hsp.verify`: `rail.verify`
   - `ACCEPT` → sign `Credit` with `CREDIT_SIGNER_PRIVATE_KEY` → relay `PerformanceEscrow.creditPayment` → status `CREDITED` → `wrapKeyFor` → status `KEY_SENT` → enqueue `notify.keyDelivered`.
   - `RETRYABLE` → retry with backoff (5 s, 15 s, 45 s, 2 m, 5 m), then `FAILED_RETRYABLE`.
   - `POLICY`/`PERMANENT` → status `REJECTED` with reason; tell the user tokens are refundable via `claimRefund` only if credited; if not credited, show the support path (the transfer reached escrow but is uncredited: an admin-free recovery is `claimRefund` after expiry only if credited, so **design note**: add `escrow.recoverUncredited(token, to, amount, receiptHash)` callable by the credit signer only for tokens above `credited` and only to the original payer. Implement this small contract addition with tests if prompt 04 didn't).
4. `GET /purchases/:id` status; `GET /purchases/:id/key` → `{ wrappedKey, ciphertext, iv }` only to the buyer.

## Fast path (USDC.e, EIP-3009)
`POST /purchases/:id/authorize` `{ authorization, signature }` → relay `fundWithAuthorization`. Still create an HSP record via `rail.payX402`-style flow if `HSP_FACILITATOR_URL` is set; otherwise mark `rail = 'eip3009'`. Behind a feature flag `FAST_PATH_ENABLED`.

## Key service
- On commit: random 32-byte AES key; `ciphertext = AES-256-GCM(key, iv, JSON(signal plaintext without salt))`; store `ciphertext`, `iv`; store `aes_key_enc` and `salt_enc` encrypted under `KEY_SERVICE_MASTER_KEY` (AES-GCM, key id prefix for rotation).
- Buyer public key: users register a **dedicated encryption keypair**, not their wallet key. The frontend derives it deterministically from a wallet signature (`sign("Nundina encryption key v1")` → HKDF → secp256k1 private key), keeps the private key in the browser only, and posts the public key to `POST /me/encryption-key`. Agents generate and post one directly.
- `wrapKeyFor(purchase)`: ECIES (secp256k1, `eciesjs`) of the AES key to the buyer's public key → `key_deliveries`.
- `revealMaterial(signalId)`: returns plaintext + salt for `SignalBook.reveal`/resolver calls; only callable internally (keeper and reveal job).
- Never log plaintext, keys, or salts. Add a log redaction test.

## Reveal job
On `Settled` or on resolution, call `SignalBook.reveal` if not yet revealed (the keeper may already reveal via resolver). Also schedule a safety reveal at `validUntil + 1h`.

## Tests
- MockRail end to end on anvil: create intent → real ERC-20 transfer to escrow → submit → verify ACCEPT → credit on-chain → key wrapped → buyer decrypts with their private key and gets the original signal.
- Replay the same `paymentId` → no double credit. Wrong amount → `POLICY`. Transfer to wrong address → `POLICY`.
- Capacity full → 409 before any payment.
- Key endpoint returns 403 to non-buyers; plaintext never appears in logs (assert via pino test transport).
- `HspRail` unit tests with the SDK mocked to match the guide's shapes.

## Done when
- [ ] With `HSP_MODE=mock`, a full purchase works on testnet.
- [ ] Switching to `HSP_MODE=live` needs only env values (document the exact steps in `apps/api/HSP.md`).
- [ ] Each purchase stores `hsp_payment_id` and an explorer URL for the README later.

## Out of scope
Telegram UI (09), web UI (12), agents (13).
