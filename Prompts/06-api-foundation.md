# Prompt 06: API foundation (Hono, Postgres, auth, read endpoints, relayer)

## Context
Monorepo + shared package exist (01). Contracts may still be in progress; use the interfaces/ABIs that exist and mock what doesn't. Read first:
- `Architecture/03-backend.md` (all of it)
- `Architecture/01-how-it-works.md` §1.7 (what lives where)
- `Architecture/06-sdks-and-packages.md` §6.3 (api packages)

## Goal
A running `apps/api` with the database schema, migrations, authentication, every **public read** endpoint, a sponsored-transaction relayer, and a job queue. Payment and key endpoints come in prompt 07.

## Architecture
```
apps/api/
├── src/
│   ├── index.ts                 Hono app, node-server, graceful shutdown
│   ├── env.ts                   zod-validated env
│   ├── db/schema.ts             drizzle tables (below)
│   ├── db/client.ts
│   ├── db/migrations/           drizzle-kit generated
│   ├── auth/siwe.ts             nonce → verify → session cookie (httpOnly, 7d)
│   ├── auth/telegram.ts         Telegram Mini App initData HMAC verification
│   ├── auth/apiKey.ts           hashed API keys for agents
│   ├── auth/internal.ts         INTERNAL_SECRET header for service-to-service
│   ├── chain/clients.ts         viem public + wallet clients (relayer)
│   ├── chain/relayer.ts         nonce manager, gas estimate, retry, idempotency
│   ├── jobs/queue.ts            pg-boss setup
│   ├── routes/public.ts         /stats /providers /signals /prices /contracts
│   ├── routes/providers.ts      register, link-telegram, me/provider
│   ├── routes/drafts.ts         POST /drafts, POST /drafts/:id/confirm (commit relay)
│   ├── routes/health.ts
│   ├── services/prices.ts       OHLC from Binance REST, cached in Postgres
│   └── lib/errors.ts, lib/pagination.ts, lib/log.ts (pino)
└── test/
```

## Database (drizzle + `postgres` driver)
Create exactly the tables in `Architecture/03-backend.md` §3.3:
`users, providers, signal_drafts, signals, purchases, key_deliveries, settlements, provider_scores, agents, agent_actions, shadow_channels, shadow_calls`.
Rules:
- Money as `numeric(38,0)` in base units (6-dec tokens) or bigint; never floats.
- Prices as `numeric(38,0)` with 8 decimals.
- `signals.id` = on-chain signal id (bigint), unique `commit_hash`.
- Sensitive columns `aes_key_enc`, `salt_enc` are `bytea`, encrypted by prompt 07's key service.
- Indexes: `signals(provider_id, status)`, `signals(valid_until)`, `purchases(signal_id)`, `purchases(buyer_user_id)`, unique `purchases(hsp_payment_id)`, `provider_scores(provider_id, period)`.
- Seed script with 5 fake providers and 60 settled signals so the frontend can be built against real-looking data (`pnpm --filter api db:seed`).

## Auth
- **SIWE:** `GET /auth/nonce`, `POST /auth/verify` (EIP-4361 message, chain 177), `POST /auth/logout`. Session stores `userId`, `wallet`.
- **Telegram:** middleware validating `X-Telegram-Init-Data` per Telegram docs (HMAC-SHA256 with `WebAppData` key), max age 1 h. Links/creates the user by `telegram_id`.
- **API keys:** `Authorization: Bearer nk_...`, stored hashed (sha256), scoped to an agent.
- **Internal:** `X-Internal-Secret`.

## Public endpoints (exact shapes, zod-validated, cursor pagination)
- `GET /stats` → `{ signalsCommitted, signalsSettled, paymentsSettled, refundsPaid, volumeUsd, providers }`
- `GET /providers?market&period=7d|30d|all&type=human|agent|aggregator&verified&observed&sort&cursor&limit` → rows with score fields from `provider_scores`; `probation: n < 30`.
- `GET /providers/:handle`, `GET /providers/:handle/signals`
- `GET /signals?status&market&provider&cursor&limit`, `GET /signals/:id` (includes tx hashes, upstream tree, purchase count; **never** plaintext before reveal)
- `GET /prices?market&from&to&interval` (Binance klines, cached)
- `GET /contracts` → addresses + ABIs from `packages/shared`

## Commit relay (`POST /drafts/:id/confirm`)
Body: `{ signal: Signal (without salt), commitAuth, providerSig }`. Steps:
1. Load draft, check it belongs to the authed provider.
2. Generate `salt` (32 random bytes). Recompute `commitHash = hashSignal({...signal, salt})` and check it equals `commitAuth.commitHash` signed by the provider. (The Mini App must get the salt first: add `POST /drafts/:id/prepare` that returns `{ salt, commitHash, typedData }`; the salt is stored encrypted on the draft.)
3. Hand plaintext to the key-service interface `encryptSignal()` (stub now; prompt 07 implements). Store ciphertext.
4. Relay `SignalBook.commit(...)` from the relayer wallet. Idempotent by draft id.
5. Insert `signals` row with status `COMMITTED`; enqueue `notify.locked` job.

## Relayer
- Single wallet from `RELAYER_PRIVATE_KEY`; in-process nonce manager with DB lock; gas estimate × 1.2; resubmit with +15% gas after 60 s; record every tx in a `relayed_txs` table (add it) with purpose and idempotency key.
- Refuse to send if HSK balance < threshold; expose in `/health`.

## Tests (vitest + a test Postgres via docker)
- SIWE happy path and replayed nonce.
- Telegram initData valid / tampered / expired.
- `/providers` pagination and probation flag.
- `/signals/:id` never leaks plaintext for unrevealed signals.
- Commit relay against **anvil forked** from HashKey testnet or a local deploy of the contracts (use `forge script` in test setup).

## Done when
- [ ] `pnpm --filter api dev` serves on :8787; `/health` reports DB, RPC, relayer balance.
- [ ] Migrations run from scratch; seed works.
- [ ] OpenAPI JSON generated at `/openapi.json` (use `@hono/zod-openapi` or equivalent).
- [ ] All tests green.

## Out of scope
HSP, purchases, key delivery (07). Indexing chain events (08 writes the same tables from events; design the tables so either source can fill them).
