# What the build needs from you

Collected while running Prompts 01–15. Everything below has a placeholder or mock so the code runs today; fill these in to go live.

| # | Item | Where it goes | Current placeholder |
|---|---|---|---|
| 1 | Foundry is installed at `~/.foundry/bin` but not on your PATH | add `C:\Users\dell\.foundry\bin` to PATH | scripts call it by full path |
| 2 | **APRO allowlist**: ask APRO to allowlist our deployed `AproPushAdapter` on their HashKey access controller `0xB0120807783212CC7D6c4b32a2A27FeF2A19B143` (BTC/USD + HSK/USD) | APRO team | Resolver falls back to Supra push storage automatically (`contracts/ORACLES.md`) |
| 3 | **Supra pull proof API**: URL + request format for HashKey proofs (`SUPRA_PROOF_API_URL`), and the HSK/USD pair index | Supra docs/team | `touchProofsEnabled = false`, all signals resolve at expiry; HSK/USD market has no Supra pair |
| 4 | **Fund the testnet deployer** `0xbCf0254820F49a5E537F075c1A6491F2FA0b8b31` with ~0.1 testnet HSK (faucet), then run `pnpm contracts:deploy:testnet && pnpm contracts:smoke && pnpm contracts:export`. Keys for deployer/relayer/keeper/credit signer were generated into your local `.env` (gitignored) | HashKey testnet faucet | Everything runs on a local anvil chain (31337) with the same contracts |
| 5 | **Testnet explorer URL** for Blockscout verification (`HSK_TESTNET_EXPLORER_URL`); `testnet-explorer.hsk.xyz` did not resolve | HashKey docs | Testnet deploy can run with `SKIP_VERIFY=1` |
| 6 | **Mainnet go-ahead + ≥ 37 HSK** on the mainnet deployer (or your own `DEPLOYER_PRIVATE_KEY`). Deploy is guarded by `CONFIRM_MAINNET=yes`; I did **not** deploy to mainnet | You | Dry-run against a mainnet fork passes |
