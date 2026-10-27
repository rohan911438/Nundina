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
| Timelock | `0x5FbDB2315678afecb367f032d93F642f64180aa3` | `0xD264D767C0D3A75030dE7b5AB926D58d09e3626A` | not deployed |
| IdentityRegistry (ERC-8004) | `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9` | `0x4A9F0482B16146b9564143A15a1B6d26Ffd072D9` |  |
| ReputationRegistry (ERC-8004) | `0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9` | `0x3aF449FB0e190799342F9ff00f9175Ba35C2834d` |  |
| ProviderRegistry | `0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e` | `0x56898432063bD084a30448032087216cC07A2A14` |  |
| SignalBook | `0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0` | `0xCbA92a5a4B7f785E0DBe3cf40BD243242395f8aa` |  |
| OutcomeResolver | `0x610178dA211FEF7D417bC0e6FeD39F05609AD788` | `0x008dDB1a2150941E3b56d1a31bD9ce6832Fa8589` |  |
| Push price adapter | `0x5FC8d32690cc91D4c39d9d3abcBD16989F875707` (mock) | `0x9C76529551b9AbCE1dbDB4024afD5638B00b353b` (mock) |  |
| Touch verifier | `0x5FC8d32690cc91D4c39d9d3abcBD16989F875707` (mock) | `0x9C76529551b9AbCE1dbDB4024afD5638B00b353b` (mock) |  |
| RevenueRouter | `0x0DCd1Bf9A1b36cE34237eEaFef220932846BCD82` | `0x1Efe8317BDA4572b39532F7eb160FF1D0EBA45D9` |  |
| SignerCreditVerifier | `0x9A676e781A523b5d0C0e43731313A708CB607508` | `0x76E24B4B7aF6581970401336bD4898CDbD23a525` |  |
| PerformanceEscrow | `0x0B306BF915C4d645ff596e518fAf3F9669b97016` | `0x1dc2F824Da90EAd40e655e6a681979aEE6535416` |  |
| USDT | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` (mock) | `0x372325443233fEbaC1F6998aC750276468c83CC6` (HSP test token) | `0xF1B50eD67A9e2CC94Ad3c477779E2d4cBfFf9029` |
| USDC.e | `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` (mock) | `0x8FE3cB719Ee4410E236Cd6b72ab1fCDC06eF53c6` (HSP test USDC) | `0x054ed45810DbBAb8B27668922D110669c9D88D0a` |

Explorer: mainnet <https://hsk.blockscout.com>; testnet explorer URL to be confirmed (`HSK_TESTNET_EXPLORER_URL`), so the testnet contracts are not source-verified yet.

**Testnet (133) deployed 27 Oct 2026** from `0xbCf0254820F49a5E537F075c1A6491F2FA0b8b31`, start block 34969274, 37 txs (first `0x4dbb217c68339e5d55b4872b96c1969ecc3de537141fcd7f73f1cd4e7af924ec`, last `0x2643ad1ca4e41efb8c5152d908cd9cb6b73e8e4c13cd6dce75f28f9144f2b562`), ≈ 0.017 HSK. Payment tokens are HSP's own testnet USDT/USDC (the merchant gateway's onboarding table), not mocks; the oracle is still `MockPriceAdapter` (keeper pushes). `CHAIN_ID=133 pnpm contracts:check-roles` passes (timelock admin everywhere, deployer renounced, roles, wiring, caps). `contracts:smoke` on 133 passed: signal #1 committed via the relayer and revealed (bond step skipped: provider holds no HSP test USDT).

Local addresses are deterministic: local deploys and tests always use anvil's public default accounts #0–#3 (`scripts/local-keys.ts`: deployer, relayer, keeper, credit signer), so a fresh anvil + `pnpm contracts:deploy:local` reproduces them anywhere, CI included. For local dev against `pnpm chain:local`, point the API/keeper at the same accounts (`RELAYER_PRIVATE_KEY`, `KEEPER_PRIVATE_KEY`, `CREDIT_SIGNER_PRIVATE_KEY` from that file); never reuse your testnet/mainnet keys on anvil.
