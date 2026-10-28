# Deployments

Addresses are written by `script/Deploy.s.sol` to `deployments/<chainId>.json` and synced into `packages/shared/src/addresses.json` with `pnpm contracts:export`.

## Commands
| Command | What it does |
|---|---|
| `pnpm chain:local` | Local anvil chain (31337) for development |
| `pnpm contracts:deploy:local` | Full deploy to anvil (mock tokens + `MockPriceAdapter`) |
| `pnpm contracts:deploy:testnet` | Full deploy to HashKey testnet (133) + Blockscout verify |
| `pnpm contracts:dry-run:mainnet` | Simulates the mainnet deploy on a fork (no broadcast, no files written) |
| `pnpm contracts:deploy:mainnet` | **Guarded**: needs `CONFIRM_MAINNET=yes` and deployer balance ≥ 1.5× estimate |
| `pnpm contracts:verify` | Re-runs Blockscout verification for the last testnet run |
| `pnpm contracts:smoke` / `:smoke:local` | register → bond → commit (relayer) → reveal |
| `pnpm contracts:export` | ABIs → `packages/shared/src/abis`, addresses → `addresses.json` |

**Gas.** The full deploy uses about **24.3M gas**. Mainnet gas is 500 gwei, so that's about **12.2 HSK** (forge estimates at 2× = 24.3 HSK, so fund the deployer with **≥ 37 HSK**). Testnet gas is 1 gwei, so about 0.03 HSK.

**Admin.** Every `DEFAULT_ADMIN_ROLE` is handed to a `TimelockController` (1 h testnet, 24 h mainnet) whose proposer and executor is the **deployer EOA** for the hackathon. Move it to a multisig after the event.

**ERC-8004.** The canonical CREATE2 address (`0x8004A169…a432`) can't be reproduced without the reference repo's deterministic deployer, so the registries are deployed normally.

**Oracles.** Mainnet uses `FallbackPriceAdapter(AproPushAdapter → SupraPushAdapter)` for spot/expiry and `SupraPullAdapter` for touch proofs (disabled until the Supra proof API is confirmed). Local/testnet use `MockPriceAdapter` (keeper has `UPDATER_ROLE`). See `ORACLES.md`.

## Addresses
| Contract | Local (31337) | Testnet (133) | Mainnet (177) |
|---|---|---|---|
| Timelock | `0x5FbDB2315678afecb367f032d93F642f64180aa3` | `0xDF3aeF8fae78B75c5AEBD48963f05855D4ffBF86` | not deployed |
| IdentityRegistry (ERC-8004) | `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9` | `0xe77B66843E905b67421C926a15d85e7D9B42E630` |  |
| ReputationRegistry (ERC-8004) | `0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9` | `0x1aB76F0F56aA24E849aff2e3727FA5e94B2D37e2` |  |
| ProviderRegistry | `0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e` | `0x2e9363784eE46242b517b91b6b6087A76e522207` |  |
| SignalBook | `0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0` | `0x62DED8396e8cCc0E5b285049CFa0A7598c76E05f` |  |
| OutcomeResolver | `0x610178dA211FEF7D417bC0e6FeD39F05609AD788` | `0x06947AE35969c50D8960d4181834E483F2937F3F` |  |
| Push price adapter | `0x5FC8d32690cc91D4c39d9d3abcBD16989F875707` (mock) | `0x3Eb76d903191c359450F11d3075a15ed7D7104Ec` (mock) |  |
| Touch verifier | `0x5FC8d32690cc91D4c39d9d3abcBD16989F875707` (mock) | `0x3Eb76d903191c359450F11d3075a15ed7D7104Ec` (mock) |  |
| RevenueRouter | `0x0DCd1Bf9A1b36cE34237eEaFef220932846BCD82` | `0x39fa1d3eDFCB7a5CA983FeaA612bEFC27f16989c` |  |
| SignerCreditVerifier | `0x9A676e781A523b5d0C0e43731313A708CB607508` | `0xe480e2Cbb502d06AA1FcBD6B7D5BDD529D01c01d` |  |
| PerformanceEscrow | `0x0B306BF915C4d645ff596e518fAf3F9669b97016` | `0xd914E77bCfAE4780EA79FeE018e6a4834473e0Ff` |  |
| USDT | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` (mock) | `0x372325443233fEbaC1F6998aC750276468c83CC6` (HSP test token) | `0xF1B50eD67A9e2CC94Ad3c477779E2d4cBfFf9029` |
| USDC.e | `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` (mock) | `0x8FE3cB719Ee4410E236Cd6b72ab1fCDC06eF53c6` (HSP test USDC) | `0x054ed45810DbBAb8B27668922D110669c9D88D0a` |

Explorer: mainnet <https://hsk.blockscout.com>; testnet explorer URL to be confirmed (`HSK_TESTNET_EXPLORER_URL`), so the testnet contracts are not source-verified yet.

**Testnet (133) redeployed 28 Oct 2026** with the `claimRefund` OutcomeFinal fix (`docs/AUDIT.md`), from `0xbCf0254820F49a5E537F075c1A6491F2FA0b8b31`, start block 34990052, 37 txs (first `0xeb9fd02684b965e635e2c2e1b57d6b01a4edcbf2b3bae45c222b25c5b4cbf8ec`, last `0xd79619028d3a96747013e758c1c9e217bdfd456fa684a822a4f7584490f29625`), ≈ 0.017 HSK. Payment tokens are HSP's own testnet USDT/USDC (the merchant gateway's onboarding table), not mocks; the oracle is still `MockPriceAdapter` (keeper pushes). `CHAIN_ID=133 pnpm contracts:check-roles` passes (timelock admin everywhere, deployer renounced, roles, wiring, caps). The first deploy (27 Oct, start block 34969274) is superseded; its lifecycle txs in `docs/AUDIT.md` ran against the old addresses.

Local addresses are deterministic: local deploys and tests always use anvil's public default accounts #0–#3 (`scripts/local-keys.ts`: deployer, relayer, keeper, credit signer), so a fresh anvil + `pnpm contracts:deploy:local` reproduces them anywhere, CI included. For local dev against `pnpm chain:local`, point the API/keeper at the same accounts (`RELAYER_PRIVATE_KEY`, `KEEPER_PRIVATE_KEY`, `CREDIT_SIGNER_PRIVATE_KEY` from that file); never reuse your testnet/mainnet keys on anvil.
