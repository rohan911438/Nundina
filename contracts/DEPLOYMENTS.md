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
| Timelock | `0xD264D767C0D3A75030dE7b5AB926D58d09e3626A` | pending: deployer needs testnet HSK | not deployed |
| IdentityRegistry (ERC-8004) | `0x9C76529551b9AbCE1dbDB4024afD5638B00b353b` | | |
| ReputationRegistry (ERC-8004) | `0xf3E4dcfD058e94Ac515F694A68E4B71DBaBA2D32` | | |
| ProviderRegistry | `0x1Efe8317BDA4572b39532F7eb160FF1D0EBA45D9` | | |
| SignalBook | `0x76E24B4B7aF6581970401336bD4898CDbD23a525` | | |
| OutcomeResolver | `0xCbA92a5a4B7f785E0DBe3cf40BD243242395f8aa` | | |
| Push price adapter | `0x60714ba629178ed42eF6F8aD8d283071810A91ac` (mock) | | |
| Touch verifier | `0x60714ba629178ed42eF6F8aD8d283071810A91ac` (mock) | | |
| RevenueRouter | `0x1dc2F824Da90EAd40e655e6a681979aEE6535416` | | |
| SignerCreditVerifier | `0xaa101e62390694164190A62683E203a0Fa21873C` | | |
| PerformanceEscrow | `0xb5e8AA10E6b3b5C814aa86BFF06c9869BE4ff953` | | |
| USDT | `0x4A9F0482B16146b9564143A15a1B6d26Ffd072D9` (mock) | | `0xF1B50eD67A9e2CC94Ad3c477779E2d4cBfFf9029` |
| USDC.e | `0x3aF449FB0e190799342F9ff00f9175Ba35C2834d` (mock) | | `0x054ed45810DbBAb8B27668922D110669c9D88D0a` |

Explorer: mainnet <https://hsk.blockscout.com>; testnet explorer URL to be confirmed (`HSK_TESTNET_EXPLORER_URL`).

Local addresses are deterministic for a fresh anvil + the same deployer key, so re-running `pnpm contracts:deploy:local` on a fresh chain reproduces them.
