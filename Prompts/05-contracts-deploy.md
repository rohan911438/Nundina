# Prompt 05: Deploy, verify and export contracts

## Context
All contracts and tests exist (prompts 02–04). Read first:
- `Architecture/04-smart-contracts.md` §4.4–4.5 (parameters, deployment order)
- `Architecture/05-external-integrations.md` (chain, Blockscout)
- `packages/shared/src/addresses.ts`

## Goal
One command deploys the full system to HashKey **testnet**, the same command (different env) to **mainnet**, verifies every contract on Blockscout, and writes addresses + ABIs into `packages/shared` so every app picks them up.

## Architecture
```
contracts/
├── script/
│   ├── Deploy.s.sol          full deployment in order, role wiring, parameter setup
│   ├── Config.s.sol          per-chain config (oracle/token addresses, issuer, signer, treasury)
│   └── SmokeTest.s.sol       on-chain smoke: register → bond → commit → reveal (tiny amounts)
├── deployments/<chainId>.json   written by Deploy.s.sol (addresses + block numbers)
scripts/
├── export-abis.ts            forge out/ → packages/shared/src/abis/*.ts (as const)
└── sync-addresses.ts         deployments/*.json → packages/shared/src/addresses.json
```

## Deploy.s.sol order
1. `TimelockController` (min delay 1 h on testnet, 24 h on mainnet; proposer/executor = deployer multisig or deployer EOA for the hackathon, documented).
2. ERC-8004 `IdentityRegistry`, `ReputationRegistry`. **First try** the canonical CREATE2 address used on other chains (`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` for Identity) if the reference repo ships a deterministic deployer; if it can't be reproduced, deploy normally and note it.
3. `AproPushAdapter` (set BTC/USD, HSK/USD feeds), `SupraPullAdapter` (pair BTC = 0).
4. `OutcomeResolver` (touch proofs flag from config).
5. `ProviderRegistry` (bond tokens USDT + USDC.e, KYC issuer).
6. `SignalBook`.
7. `RevenueRouter`.
8. `PerformanceEscrow` (treasury, credit signer = API address from env).
9. Roles: SignalBook `RELAYER_ROLE` → relayer EOA; SignalBook `RESOLVER_ROLE` → resolver; Registry `ESCROW_ROLE` → escrow; Reputation `WRITER_ROLE` → escrow; Router caller → escrow.
10. Transfer admin roles to the timelock; renounce deployer admin.
11. Write `deployments/<chainId>.json`.

Use env vars from `.env.example` (`DEPLOYER_PRIVATE_KEY`, `RELAYER_ADDRESS`, `CREDIT_SIGNER_ADDRESS`, `TREASURY_ADDRESS`, `KYC_ISSUER_ADDRESS`). Add any missing ones to `.env.example`.

## Commands (add as package.json scripts at root)
```
pnpm contracts:deploy:testnet   forge script script/Deploy.s.sol --rpc-url $HSK_TESTNET_RPC_URL --broadcast --verify ...
pnpm contracts:deploy:mainnet   same, mainnet RPC, requires CONFIRM_MAINNET=yes
pnpm contracts:verify           re-run verification for an existing deployment
pnpm contracts:export           export-abis + sync-addresses
pnpm contracts:smoke            SmokeTest.s.sol against the chosen chain
```
Verification: Blockscout supports Foundry's `--verifier blockscout --verifier-url https://hashkey.blockscout.com/api/`. Confirm the exact URL; for testnet use the testnet explorer.

## Gas budget
Check `cast gas-price` on HashKey; at ~500 gwei and our contract sizes, estimate total deploy cost in HSK and print it before broadcasting. Mainnet deploy must abort if deployer balance < estimate × 1.5.

## Tests / checks
- `forge script` dry-run (no `--broadcast`) against a mainnet fork succeeds.
- After testnet deploy, `pnpm contracts:smoke` passes.
- `export-abis` output typechecks in `packages/shared`.

## Done when
- [ ] Testnet deployed, all contracts verified (green check on explorer).
- [ ] `packages/shared/src/addresses.json` has the testnet addresses; apps import them by chain id.
- [ ] `contracts/DEPLOYMENTS.md` table: contract, testnet address, mainnet address (filled later), explorer links.
- [ ] Mainnet command exists and is guarded; **do not run it** until prompt 15 says so (or the team decides).

## Out of scope
Off-chain apps. Changing contract logic (if a bug appears, fix it in the contract with a test, then redeploy).
