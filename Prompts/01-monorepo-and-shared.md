# Prompt 01: Monorepo scaffold and shared package

## Context
You are building **Nundina**, a pay-if-right trading-signal marketplace on HashKey Chain (chainId 177) for the HashKey Horizon Hackathon, Track 2. Before writing anything, read:
- `README.md`
- `Architecture/01-how-it-works.md`
- `Architecture/06-sdks-and-packages.md`
- `Idea/05-architecture.md` §5.2 (the Signal struct)

## Goal
Create the empty-but-working monorepo skeleton and the `packages/shared` library that every other app imports. After this prompt, every later prompt has a place to put its code and a single source of truth for types, addresses and chain config.

## Architecture
```
nundina/ (repo root, keep existing Idea/, Memory/, Architecture/, Prompts/)
├── package.json            pnpm workspaces root, scripts: build, test, lint, typecheck, dev
├── pnpm-workspace.yaml     apps/*, packages/*, agents/*
├── tsconfig.base.json      strict, ES2023, moduleResolution bundler, paths for @nundina/*
├── .env.example            every variable from Architecture/06 §6.4, with comments
├── .nvmrc                  24
├── docker-compose.yml      postgres:16 on 5432 for local dev
├── contracts/              (empty Foundry project: `forge init --no-git`, remove Counter)
├── packages/shared/
│   ├── src/chain.ts        hashkeyMainnet + hashkeyTestnet as viem `defineChain`
│   ├── src/addresses.ts    oracle + token addresses, loads deployed addresses from addresses.json
│   ├── src/addresses.json  { "177": {}, "<testnetId>": {} } filled by prompt 05
│   ├── src/eip712.ts       domain + types for Signal and CommitAuthorization
│   ├── src/signal.ts       Signal TS type, zod schema, hashSignal(), market ids
│   ├── src/enums.ts        Side, SignalStatus, Outcome, PurchaseStatus
│   ├── src/money.ts        6-decimal helpers: toUnits("1.50") → 1_500_000n, fromUnits
│   ├── src/abis/           (empty, filled by prompt 05)
│   ├── src/scoring-types.ts types only (math comes in prompt 08)
│   └── src/index.ts
└── apps/ agents/           create empty folders with a README stub each
```

## Exact specs
**Chain config** (`chain.ts`): mainnet id 177, RPC `https://mainnet.hsk.xyz`, explorer `https://hashkey.blockscout.com`, native currency HSK 18 decimals. Testnet: look up the official HashKey testnet chain id and RPC from `docs.hsk.xyz`; if you can't confirm it, leave a clearly marked `TODO(confirm)` and read both from env.

**Addresses** (`addresses.ts`), all on chain 177:
- APRO BTC/USD `0x204ED500ab56A2E19B051561258E3A45c850360F`
- APRO HSK/USD `0x86CE42c1b714149Dc3A7b17169EF67b5F78A224b`
- Supra pull `0x16f70cAD28dd621b0072B5A8a8c392970E87C3dD`
- Supra storage `0x58e158c74DF7Ad6396C0dcbadc4878faC9e93d57`
- USDT `0xF1B50eD67A9e2CC94Ad3c477779E2d4cBfFf9029` (6 dec, no EIP-3009)
- USDC.e `0x054ed45810DbBAb8B27668922D110669c9D88D0a` (6 dec, EIP-3009)

**Markets:** `market` is a `bytes32` id: `keccak256("BTC/USD")`, `keccak256("HSK/USD")`. Export a `MARKETS` map with: id, label, APRO feed address, Supra pair id (BTC = 0; others `null` until confirmed), Binance symbol (`btcusdt`).

**EIP-712** (`eip712.ts`). Domain: `{ name: "Nundina", version: "1", chainId, verifyingContract: SignalBook }`.
```
Signal(address provider,bytes32 market,uint8 side,uint256 entry,uint256 takeProfit,
       uint256 stopLoss,uint64 validUntil,uint256 pricePerSub,uint256[] upstream,
       uint16[] upstreamBps,bytes32 salt)
CommitAuthorization(address provider,bytes32 commitHash,bytes32 market,uint64 validUntil,
       uint256 pricePerSub,uint256 nonce,uint64 deadline)
```
Prices (`entry`, `takeProfit`, `stopLoss`) use **8 decimals** to match APRO. Side: `0 = LONG, 1 = SHORT`.
`hashSignal(s)` must return exactly what Solidity's `_hashTypedDataV4(structHash)` returns. That value is the `commitHash`.

**Validation (zod):** LONG requires `SL < entry < TP`, SHORT the reverse; `|TP − entry| ≥ |entry − SL|` (min 1:1); `validUntil` between 15 min and 7 days ahead; `upstream.length == upstreamBps.length ≤ 5`; bps sum ≤ 10000.

## Tests (vitest, in `packages/shared`)
- `toUnits` / `fromUnits` round-trips and rejects more than 6 decimals.
- Signal zod schema rejects bad geometry (both sides), R:R < 1, past expiry.
- `hashSignal` is deterministic; a golden vector is saved to `test/vectors/signal.json` so prompt 02 can check the Solidity side matches.

## Done when
- [ ] `pnpm install && pnpm -r typecheck && pnpm -r test` pass from a clean clone.
- [ ] `docker compose up -d` starts Postgres.
- [ ] `forge build` works in `contracts/`.
- [ ] `.env.example` lists every variable; `.gitignore` covers `.env*`, `out/`, `cache/`, `node_modules/`, `.next/`, `broadcast/` (except testnet/mainnet run logs you choose to keep).

## Out of scope
No contracts, no API, no UI. Don't add frameworks the later prompts will add.
