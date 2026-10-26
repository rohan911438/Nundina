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
| 7 | **HSP sandbox details** (from organizers): SDK repo URL, `HSP_COORDINATOR_URL`, `HSP_API_KEY`, `HSP_CHAIN`, faucet | `.env`, see `apps/api/HSP.md` | `HSP_MODE=mock`: MockRail verifies the on-chain transfer and signs receipts locally; full purchase flow tested on anvil |
| 8 | **Testnet purchase run** (prompt 07 "done when") needs item 4 first (deployer + relayer have 0 testnet HSK as of Oct 26 19:40) plus test USDT on the buyer | faucet | Same flow passes end to end on a local anvil deploy (`apps/api/test/purchases.test.ts`) |
| 9 | **Testnet indexer run** (prompt 08 "done when": commit/buy/settle on testnet visible within 10 s) needs items 4 and 8 | faucet | Ponder + projector pass end to end on anvil (`apps/indexer/test/indexer.test.ts`: commit, credit, unrevealed, settle, score job, reproject) |
| 10 | **Telegram bot token** (`TELEGRAM_BOT_TOKEN` from @BotFather) + `TELEGRAM_WEBHOOK_SECRET`; then a test channel with the bot as admin. Prompt 09 "done when" (post → locked card → buy → unlock DM → result card in a real channel) also needs items 4 and 8 | @BotFather, `.env` | Bot is tested against a fake Telegram API with the real API + DB (`apps/bot/test`, 57 tests: linking, drafts, edits, buy deep links, all notify cards) |
| 11 | **`ANTHROPIC_API_KEY`** for the LLM fallback parser (`claude-haiku-5-5`) | console.anthropic.com | Rule parser handles the 30 fixture formats; LLM path is off without a key and mocked in tests |
