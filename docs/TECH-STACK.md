# Tech stack and why

| Layer | Choice | Why | Alternatives considered |
|---|---|---|---|
| Chain | **HashKey Chain** (testnet 133, mainnet 177) | HSP, oracles and stablecoins are native; about $0.004 per commit | n/a |
| Contracts | **Solidity 0.8 + Foundry** | Fast tests, fuzzing and invariants, and tests that **fork HashKey mainnet** against the real APRO feeds and tokens | Hardhat |
| Contract libraries | **OpenZeppelin** (EIP712, ECDSA, SafeERC20, ReentrancyGuard, Pausable, TimelockController) | Audited building blocks for signatures and token handling | Solady (gas savings don't matter here) |
| Identity and reputation | **ERC-8004** Identity and Reputation registries | Portable agent reputation; first deployment on HashKey | A custom registry (not portable) |
| Payments | **HSP** Payment Mandates (EIP-712), HSP merchant gateway, x402 | The hackathon's settlement layer; agent-friendly and non-custodial | Raw ERC-20 transfers |
| Stablecoins | **USDT + USDC** | USDT has the most holders; USDC supports gasless EIP-3009 authorizations | n/a |
| Oracles | **APRO push** (expiry) + **Supra** push fallback and pull proofs (touches) | Both live on HashKey; push is simple, pull gives timestamped precision | Chainlink Data Streams (access gated) |
| Chain client | **viem** | Typed, fast, custom chains, EIP-712 signing | ethers v6 |
| Backend | **Node 24 + Hono**, Postgres with drizzle, **pg-boss** for jobs | One language across services; jobs live in the same database, so there is no extra queue to run | Express, NestJS, Redis queues |
| Indexer | **Ponder** + our own projector | Typed event indexing for any EVM chain; the projector keeps API tables rebuildable | The Graph (no hosted HashKey support) |
| Telegram | **grammY** + Telegram Mini App | Type-safe and well maintained; the Mini App gives wallet flows inside Telegram | Telegraf |
| Signal parsing | Cornix-style rules + **Claude Haiku** structured output, then human confirmation | Rules are free and deterministic for common formats; the LLM covers messy posts | LLM only, regex only |
| Encryption | **AES-256-GCM** per signal + **ECIES (secp256k1)** per buyer, via `@noble` libraries | No extra network dependency; simple to audit | Lit Protocol threshold encryption (planned), TEEs |
| Web | **Next.js 16, Tailwind, shadcn/ui, wagmi, lightweight-charts** | Server-rendered public pages; wallet code loaded only where needed; entry, TP and SL drawn on the price chart | Vite + React |
| AI agents | `@modelcontextprotocol/sdk`, viem accounts per agent | Any MCP client can discover and buy signals | n/a |
| Hosting | **Vercel** (web), **Render** (API, bot, keeper, indexer, Postgres) | Auto-deploys from GitHub; free tiers fit a hackathon | VPS |
| CI | GitHub Actions | Typecheck, tests, Foundry and `pnpm audit` on every push | n/a |

## One language off-chain

Everything off-chain is **TypeScript**: API, bot, keeper, indexer, agents, MCP and web, in one pnpm workspace. Shared types, such as the EIP-712 Signal struct, the scoring functions, ABIs and addresses, live in `packages/shared`, so every service agrees on them.
