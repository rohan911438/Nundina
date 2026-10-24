# 6. Tech Stack and Why

| Layer | Choice | Why this | Alternatives considered |
|---|---|---|---|
| Chain | **HashKey Chain mainnet** (chainId 177) + testnet | Hackathon requirement; HSP, oracles and stablecoins are live; about $0.004 per commit | n/a |
| Contracts | **Solidity 0.8.x + Foundry** | Fast tests, **forking HashKey mainnet** (`--fork-url https://mainnet.hsk.xyz`) so tests run against real APRO feeds and USDC.e, built-in fuzzing, easy Blockscout verification | Hardhat (slower; we don't need its plugins) |
| Contract libraries | **OpenZeppelin** (EIP712, ECDSA, SafeERC20, ReentrancyGuard, Pausable, TimelockController) | Audited building blocks for signatures and token handling | Solady (more gas-efficient, but gas is near-free here) |
| Identity and reputation | **ERC-8004** reference Identity and Reputation registries | Portable agent reputation; first deployment on HashKey | Custom registry (not portable) |
| Payments | **HSP**: `@hsp/sdk` (`HSPClient.pay`, `HSPVerifier.verify`, `x402Gate`), `@hsp/mcp` (SpendGuard), hosted Coordinator; `@hsp/devkit` as a stretch | Required, and the officially recommended tooling earns points | Raw ERC-20 transfers (would break the rules) |
| Stablecoins | **USDT** (HSP evm-transfer) + **USDC.e** (EIP-3009 fast path / x402) | USDT has the most holders; USDC.e is the token that supports gasless authorizations | n/a |
| Oracles | **APRO push** (settlement at expiry) + **Supra pull** (TP/SL touch proofs) | Both are live on HashKey mainnet; push is simple, pull gives timestamped precision | Chainlink Data Streams (verifier present on HashKey, but access is gated) |
| Chain client | **viem** (TypeScript) | Typed, fast, supports custom chains, signs EIP-712 typed data | ethers v6 |
| Telegram bot | **grammY** (TypeScript) | Type-safe, active plugin ecosystem (conversations, sessions, rate limiting), runs on Node | Telegraf (older types), GramIO (newer, smaller community) |
| Telegram Mini App | **Telegram WebApp + Reown AppKit / WalletConnect** | Wallet connection inside Telegram with no app install; supports custom EVM chains | Embedded wallets like Privy (faster onboarding, but a vendor dependency; possible later) |
| Agent wallets | **HashKey AgentKit** (`HashkeyHSK/agentkit`) | Official HashKey fork of Coinbase AgentKit, which earns recommended-tool points | Plain viem wallets |
| Signal parsing | **Rule-based Cornix format parser** first, then **Claude Haiku 5.5** structured output (JSON schema) | Most Telegram signals already use the Cornix format, so rules are free and deterministic; the LLM covers messy posts; human confirmation always follows | Regex only (too brittle); a large model (overkill and costly) |
| Signal encryption | **AES-256-GCM** per signal + **ECIES (secp256k1)** key wrapping per subscriber, via `@noble/ciphers` and `@noble/curves` | Uses the subscriber's existing wallet key, has no extra network dependency, and is simple to audit | **Lit Protocol** threshold encryption (no single key holder, but adds a node network, its HashKey support is unconfirmed, and it costs time). Planned for v2, along with TEEs |
| Storage of ciphertext | Postgres for the MVP; IPFS (web3.storage / Pinata) as a stretch | Only the hash goes on-chain; plaintext is revealed on-chain later | Arweave |
| Indexer | **Ponder** | Event indexing in TypeScript into Postgres with a GraphQL API; supports any EVM chain by RPC | The Graph (no hosted support for HashKey), a custom viem watcher |
| Database | **Postgres** (Neon or Supabase) | Leaderboard queries, sessions, shadow-scorer data | n/a |
| Backend API | **Node 24 + Hono** (TypeScript) | Lightweight, same language as the bot and indexer, runs anywhere | Express, NestJS |
| Keeper | Node worker + **Binance public WebSocket** (spots touches early) + Supra pull client (proofs) | CEX data is free and fast for detection; the proof itself comes from the oracle | Gelato / Chainlink Automation (not confirmed on HashKey) |
| MCP server | **`@modelcontextprotocol/sdk`** (TS) + `x402Gate` | Lets any AI agent discover and buy signals; fits the HSP MCP pattern | n/a |
| Web app | **Next.js + Tailwind + shadcn/ui**, OG-image badges | Fast to build; shareable profile cards drive distribution | Vite + React |
| Charts | Lightweight-charts (TradingView open source) | Shows each signal's entry, TP and SL on the price chart | Recharts |
| Hosting | Vercel (web), Railway or Fly (bot, API, keeper, indexer) | Free or cheap tiers; quick deploys | VPS |
| Monitoring | Blockscout verified contracts + a simple status page | Judges can click through every transaction | n/a |

## Language decision
Everything off-chain is **TypeScript**: bot, API, keeper, indexer, MCP and web. One language, one package manager (pnpm workspaces), and shared types such as the EIP-712 Signal struct. HSP's SDKs are TypeScript too.

## Repo layout
```
nundina/
  contracts/        Foundry: SignalBook, PerformanceEscrow, OutcomeResolver, RevenueRouter, ProviderRegistry, erc8004/
  packages/shared/  EIP-712 types, scoring lib, ABIs
  apps/bot/         grammY bot + mini app
  apps/api/         Hono API, HSP integration, key service
  apps/keeper/      price watcher + settler
  apps/indexer/     Ponder
  apps/mcp/         MCP server
  apps/web/         Next.js leaderboard
  agents/           strategy x3, execution, aggregator (AgentKit)
```
