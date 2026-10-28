# Payments: HSP (mock and live)

A purchase moves money **wallet → `PerformanceEscrow`** directly. The API never holds funds. It
registers the payment, verifies the settlement itself, and then credits the escrow with a signed
`Credit` message (see `contracts/src/lib/ReceiptLib.sol`).

```
POST /purchases            → rail.createIntent   (mandate typed data, payee = escrow)
wallet signs mandate + sends ERC-20 transfer to the escrow
POST /purchases/:id/submit → rail.submit         (needs an Idempotency-Key header)
job hsp.verify             → rail.verify
   ACCEPT     → sign Credit → relay creditPayment → wrap key (ECIES) → KEY_SENT
   RETRYABLE  → retry after 5s, 15s, 45s, 2m, 5m → FAILED_RETRYABLE
   POLICY / PERMANENT → REJECTED; any tokens that reached the escrow go back to the payer
                        through recoverUncredited (authorised by the credit signer)
GET /purchases/:id/key     → { wrappedKey, ciphertext, iv } (buyer only)
```

Both rails check the ERC-20 `Transfer` log on-chain themselves (`src/payments/observe.ts`). Nothing
is credited because a status field said "paid".

## Direct mode (default)

`HSP_MODE=direct` (`mock` is accepted as the old name). The payer signs the same HSP-style Payment Mandate (EIP-712) and sends the real ERC-20 transfer to the escrow itself; only the hosted gateway hop is skipped. `DirectRail` keeps mandates in `rail_payments`, checks the transfer, and signs
receipts with `MOCK_ADAPTER_PRIVATE_KEY`. If that key is not set, it uses a key derived from
`INTERNAL_SECRET`. The outcome classes are the same as HSP's, so the whole product runs without HSP
credentials.

## Switching to live

Only environment values change:

1. Get the sandbox details from the organizers: `<COORDINATOR_URL>`, `<API_KEY>`, `<CHAIN>`, and optionally
   `<FACILITATOR_URL>`.
2. Set these in `.env`:
   ```
   HSP_MODE=live
   HSP_COORDINATOR_URL=<COORDINATOR_URL>
   HSP_API_KEY=<API_KEY>
   HSP_CHAIN=hashkey-testnet            # or the chain name they give you
   HSP_ADAPTER_ADDRESS=0x...            # optional out-of-band pin; must match GET /chains
   HSP_EXPLORER_URL=                    # optional; defaults to <COORDINATOR_URL>/explorer
   ```
3. Restart the API. At boot it calls `GET <COORDINATOR_URL>/chains` and pins the adapter address. If that
   address differs from `HSP_ADAPTER_ADDRESS`, the API refuses to start.
4. Check that the escrow token is the token HSP settles on that chain (`/requirements?chain=`).
   If it isn't, allow it on `PerformanceEscrow` through the timelock.

When the SDK repository is shared, look for the `TODO(hsp-live)` markers in `src/payments/`:
- swap the raw fetches for `HSPClient`;
- swap the local receipt checks for `HSPVerifier.verify(mandate, receipt, attestations)`;
- use the SDK's mandate builder in place of `MANDATE_TYPES`.

The `PaymentRail` interface does not change.

## Explorer links

Every purchase stores `hsp_payment_id` (the mandate hash) and `explorer_url`. In live mode the link
is the HSP explorer. In direct mode it is the chain explorer's tx page.

## USDC.e fast path

Set `FAST_PATH_ENABLED=true`. `POST /purchases/:id/authorize` takes an EIP-3009
`ReceiveWithAuthorization` signature whose nonce is `keccak256(abi.encode(signalId, from))`, and
relays `fundWithAuthorization`. That is one transaction with no separate credit step.
