# Prompt 12: Wallet flows, dashboards and the Telegram Mini App

## Context
Public web pages (11), purchases + keys (07), bot (09). Read first:
- `Architecture/02-frontend-pages.md` pages 5–8 and §2.3 Mini App screens
- `Architecture/01-how-it-works.md` §1.2–1.3
- `apps/api/src/routes/purchases.ts`, `drafts.ts` and `keys/keyService.ts` (encryption-key derivation contract)

## Goal
Users can connect a wallet, become a provider (identity + bond), confirm signals, buy signals through HSP, decrypt them, and manage everything from dashboards, both on the web and inside Telegram.

## Architecture
```
apps/web/
├── app/
│   ├── start/page.tsx
│   ├── dashboard/page.tsx                 subscriber
│   ├── dashboard/provider/page.tsx
│   ├── dashboard/agents/page.tsx
│   └── tg/
│       ├── layout.tsx                     Telegram WebApp init, theme from Telegram, back button
│       ├── connect/page.tsx
│       ├── confirm/[draftId]/page.tsx
│       ├── buy/[id]/page.tsx
│       └── my/page.tsx
├── lib/wallet/                            Reown AppKit config (HashKey 177 + testnet), SIWE flow
├── lib/crypto/encKey.ts                   derive encryption keypair from wallet signature; decrypt(ECIES + AES-GCM)
├── lib/hsp/pay.ts                         build + sign mandate, send ERC-20 transfer, submit
└── components/flows/                      BuyFlow, ProviderOnboarding, BondManager, ConfirmSignal, AgentPolicyForm
```
Packages: `@reown/appkit`, `@reown/appkit-adapter-wagmi`, `wagmi`, `viem`, `@telegram-apps/sdk-react`, `eciesjs`, `@noble/ciphers`, `@noble/hashes`.

## Wallet and session
- Reown AppKit with a custom network for HashKey (from `packages/shared/chain.ts`). Prompt the user to switch network if needed.
- After connect: SIWE (`/auth/nonce` → sign → `/auth/verify`). Inside Telegram: also send `initData` so the API links Telegram id ↔ wallet.
- **Encryption key:** on first connect, ask the wallet to sign `"Nundina encryption key v1\n<address>"`; HKDF-SHA256 → secp256k1 private key; keep it in memory and `sessionStorage` only (wrap reads in try/catch); post the public key to `/me/encryption-key`. Re-derivable any time by signing again, so nothing is lost.

## Flows
**BuyFlow** (`/tg/buy/[id]` and the Buy box on `/s/[id]`):
1. Show provider, score, price, token picker (USDT / USDC.e), "refund if wrong" explainer, capacity left.
2. `POST /purchases` → get mandate typed data.
3. Wallet signs the mandate (`eth_signTypedData_v4`), then sends the ERC-20 `transfer` to the escrow.
4. `POST /purchases/:id/submit` with signature + tx hash.
5. Progress UI: Paid → Verified by HSP (show payment id + HSP explorer link) → Credited (tx link) → Unlocked.
6. Fetch `/purchases/:id/key`, decrypt locally, show the signal. Never send plaintext back to the server.
Errors: wrong network, insufficient balance (show both tokens' balances), user rejected, capacity full, HSP `POLICY` (show reason).
If `FAST_PATH_ENABLED` and token is USDC.e: offer gasless EIP-3009 signature instead of a transfer.

**ConfirmSignal** (`/tg/confirm/[draftId]`): shows parsed fields large and clear; editable fields with live validation (shared zod); price per signal and validity; **Lock it** → `POST /drafts/:id/prepare` → sign `CommitAuthorization` → `POST /drafts/:id/confirm` → show commit tx link; close Mini App.

**ProviderOnboarding** (`/start` → "I post signals"): checklist with live status:
1. Wallet connected.
2. ERC-8004 identity: call `IdentityRegistry.register(agentURI)` where agentURI points to `/api/agent-card/:handle` (add this JSON route: name, description, Telegram, endpoints).
3. `ProviderRegistry.register(...)`.
4. Link Telegram channel (deep link to bot `/link_channel`).
5. Bond: approve + `depositBond`; show capacity = free bond ÷ price.
6. Optional KYC attestation (if issuer available; else "coming soon").

**Provider dashboard:** bond card (deposit / request withdraw / withdraw with countdown), signals tabs (Live / Awaiting reveal / Settled), earnings, settings (default price, validity, practice toggle, pay-if-works locked until probation passes), badge embed.

**Subscriber dashboard:** active purchases (decrypted locally, live P/L vs entry from `/prices`), history (paid, refunded, slash received), totals, followed providers.

**Agents page:** create execution agent (API returns agent wallet address + API key once), fund it (transfer button), policy form (daily budget, per-signal cap, min score, markets, providers allow/deny, auto-trade + slippage), activity table, pause switch. Backed by `/agents` endpoints from `Architecture/03-backend.md`.

**`/tg/my`:** purchased signals list, decrypted on device, with result badges.

## Telegram specifics
- Use `@telegram-apps/sdk-react`: `ready()`, `expand()`, theme params → CSS variables, BackButton, MainButton for the primary action (Buy / Lock it).
- WalletConnect inside Telegram: use AppKit's mobile deep links; test on iOS and Android Telegram.
- If opened outside Telegram, `/tg/*` redirects to the web equivalent.

## Tests
- Unit: encryption key derivation is deterministic per address; decrypt round-trip with API-side encryption fixtures.
- Playwright with a mocked wallet (wagmi `mock` connector) for BuyFlow and ConfirmSignal against a local anvil + API in mock HSP mode.
- Manual checklist (write it in `apps/web/QA.md`): real wallet on testnet in Telegram on a phone, buy → unlock.

## Done when
- [ ] A new user on a phone goes from Telegram Buy button to decrypted signal in under 60 seconds on testnet.
- [ ] A new provider completes onboarding and their next channel post becomes a commit.
- [ ] Dashboards show real data from the indexer.

## Out of scope
Agent runtime itself (13). MCP (14).
