# 5. External integrations

Legend: 🔴 must-have for MVP · 🟡 stretch · ✅ confirmed working/available · ❓ still to confirm

| # | Service | What we use it for | What we need from it | Priority | Status |
|---|---|---|---|---|---|
| 1 | **HashKey Chain** (RPC, chainId 177; testnet) | Deploy and call contracts | RPC `https://mainnet.hsk.xyz`, testnet RPC, HSK for gas, faucet `https://faucet.hsk.xyz` | 🔴 | ✅ RPC works |
| 2 | **HSP Coordinator** | Register mandates, observe transfers, get receipts, Explorer links | REPO_URL, COORDINATOR_URL, API_KEY, CHAIN name, FAUCET_URL, adapter address (`GET /chains`) | 🔴 | ❓ waiting on organizers |
| 3 | **HSP Facilitator** (x402) | x402 payments for the MCP server, EIP-3009 path | FACILITATOR_URL | 🟡 | ❓ |
| 4 | **HSP KYC issuer** | "Verified Provider" badge via `attests:kyc` | ISSUER_URL, issuer public key | 🟡 | ❓ (KYC testnet: `kyc-testnet.hunyuankyc.com`) |
| 5 | **APRO oracle** (push) | Expiry settlement price; entry price check | BTC/USD `0x204E…360F`, HSK/USD `0x86CE…224b` | 🔴 | ✅ read on-chain |
| 6 | **Supra oracle** (pull) | TP/SL touch proofs | Pull contract `0x16f7…C3dD`, storage `0x58e1…7d57`, proof API endpoint, pair IDs | 🔴 (BTC) | ❓ proof format + pairs |
| 7 | **Telegram Bot API** | Bot, channel admin, DMs, inline buttons | Bot token from @BotFather, webhook URL | 🔴 | ✅ free |
| 8 | **Telegram Mini Apps** | Wallet actions inside Telegram | Mini App registered with @BotFather (URL), HTTPS domain | 🔴 | ✅ free |
| 9 | **Reown (WalletConnect)** | Wallet connection on web + Mini App | Reown project ID; add HashKey chain 177 as custom network | 🔴 | ✅ free tier |
| 10 | **Binance public WebSocket** | Fast price stream to detect touches | No key (public `wss://stream.binance.com`) | 🔴 | ✅ (detection only; proof comes from Supra) |
| 11 | **Anthropic Claude API** (Claude Haiku) | Fallback signal parsing with a JSON schema | API key | 🔴 | ✅ |
| 12 | **Blockscout** (`hashkey.blockscout.com`) | Contract verification, tx links in UI | API key for `forge verify` (if required) | 🔴 | ✅ |
| 13 | **HashKey AgentKit** (`HashkeyHSK/agentkit`) | Wallets for our agents | Clone repo, CDP-style config | 🟡 | ❓ check fit |
| 14 | **HSKSwap** | Execution agent auto-trades | Router address + ABI | 🟡 | ❓ |
| — | Hosting: Vercel (web), Railway/Fly (bot, api, keeper, indexer, mcp, agents), Neon/Supabase (Postgres) | Run everything | Accounts, env vars, custom domain | 🔴 | ✅ |
| — | IPFS (Pinata / web3.storage) | Ciphertext storage | API key | Later | — |

## 5.1 How each must-have integration plugs in
**HSP** (in `apps/api/src/hsp/`): one module with an interface `PaymentRail { createIntent, submit, verify }` and two implementations: `HspRail` (real, `@hsp/sdk`) and `MockRail` (fake receipts signed by a local key). Switch by env `HSP_MODE=mock|live`. This is the D18 cut rule.

**Oracles** (in contracts + `apps/keeper/src/oracles/`): `AproPushAdapter` reads `latestRoundData`; `SupraPullAdapter` verifies a proof. Keeper has a `SupraClient` that fetches proofs by pair ID and timestamp.

**Telegram** (in `apps/bot`): webhook mode behind the same domain; bot must be **admin** in the provider's channel to read posts.

**Wallets**: Reown AppKit + wagmi on the frontend; the HSP SDK's `eip1193` signer takes the same provider, so the user's key never leaves their wallet.

## 5.2 Accounts checklist (do once)
- [ ] HashKey dev Telegram: request HSP sandbox values
- [ ] Deployer wallet + relayer wallet + keeper wallet (separate keys), funded with HSK
- [ ] Demo wallets with USDC.e / USDT ($20–50)
- [ ] @BotFather: bot token + Mini App
- [ ] Reown project ID
- [ ] Anthropic API key
- [ ] Neon/Supabase Postgres
- [ ] Vercel + Railway/Fly accounts, domain
- [ ] Blockscout API key (if needed for verification)
