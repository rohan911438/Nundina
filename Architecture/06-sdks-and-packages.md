# 6. SDKs, packages and environment

Monorepo: **pnpm workspaces**, Node 24, TypeScript everywhere off-chain. Pin exact versions in `package.json` (HSP is pre-1.0 and may change).

## 6.1 HashKey / HSP SDKs (the "official" layer that earns bonus points)
| Package | Used in | For | Status |
|---|---|---|---|
| `@hsp/sdk` | api, agents, mcp | `HSPClient.pay()`, `payX402()`, `HSPVerifier.verify()`, `x402Gate`, `fetchWithX402` | ❓ repo not shared yet |
| `@hsp/core` | api, shared | Types, capabilities, chain registry (`resolveChain`) | ❓ |
| `@hsp/mcp` | execution agent | `hsp_quote / hsp_pay / hsp_status / hsp_verify` + **SpendGuard** caps | ❓ |
| `skills/hsp-pay` | execution agent (Claude-based) | Safe quote → approve → pay flow | ❓ |
| `@hsp/devkit` | (stretch) custom adapter | Conformance-tested "conditional-release" adapter | ❓ |
| HashKey **AgentKit** (`HashkeyHSK/agentkit`) | agents | Agent wallets and actions | ❓ check fit |

HSP install (from the guide): `git clone <REPO_URL>`, then link packages into the workspace (e.g. `"@hsp/sdk": "link:../hsp/packages/sdk"`), since they are not on npm.

## 6.2 Contracts (`contracts/`)
| Tool / lib | For |
|---|---|
| Foundry (`forge`, `cast`, `anvil`) | Build, test (fork mainnet with `--fork-url https://mainnet.hsk.xyz`), deploy, verify |
| `openzeppelin-contracts` | EIP712, ECDSA, SafeERC20, ReentrancyGuard, Pausable, AccessControl, TimelockController |
| ERC-8004 reference contracts | Identity + Reputation registries |
| Supra pull interface | Proof verification in `SupraPullAdapter` |
| `forge-std` | Tests, fuzz, invariants |

## 6.3 Per app
| App | Packages |
|---|---|
| **shared** | `viem`, `zod`, `abitype` |
| **api** | `hono`, `@hono/node-server`, `@hono/zod-validator`, `viem`, `drizzle-orm` + `postgres`, `pg-boss`, `siwe`, `@noble/ciphers` (AES-GCM), `@noble/curves` + `eciesjs` (ECIES secp256k1), `@hsp/sdk`, `pino` |
| **bot** | `grammy`, `@grammyjs/conversations`, `@grammyjs/ratelimiter`, `@anthropic-ai/sdk` (Haiku parser), `zod` |
| **keeper** | `viem`, `ws` (Binance stream), Supra pull client, `pg-boss` |
| **indexer** | `ponder` |
| **mcp** | `@modelcontextprotocol/sdk`, `@hsp/sdk` (`x402Gate`) |
| **agents** | AgentKit, `@hsp/mcp` or `@hsp/sdk`, `viem`, `@anthropic-ai/sdk` (news-sentiment agent) |
| **web** | `next`, `react`, `tailwindcss`, shadcn/ui, `@reown/appkit` + `@reown/appkit-adapter-wagmi`, `wagmi`, `viem`, `@tanstack/react-query`, `lightweight-charts`, `@telegram-apps/sdk-react`, `@vercel/og`, `@noble/curves` + `eciesjs` (decrypt in browser) |

Dev tooling: `typescript`, `tsx`, `vitest`, `eslint`, `prettier`, `turbo` (optional), Docker Compose for local Postgres.

## 6.4 Environment variables
```bash
# chain
HSK_RPC_URL=https://mainnet.hsk.xyz
HSK_TESTNET_RPC_URL=
CHAIN_ID=177
DEPLOYER_PRIVATE_KEY=
RELAYER_PRIVATE_KEY=
KEEPER_PRIVATE_KEY=
BLOCKSCOUT_API_KEY=

# HSP (from organizers)
HSP_MODE=mock            # mock | live
HSP_COORDINATOR_URL=
HSP_API_KEY=
HSP_CHAIN=
HSP_ADAPTER_ADDRESS=     # pinned from GET /chains
HSP_FACILITATOR_URL=
HSP_ISSUER_URL=

# oracles
APRO_BTC_USD=0x204ED500ab56A2E19B051561258E3A45c850360F
APRO_HSK_USD=0x86CE42c1b714149Dc3A7b17169EF67b5F78A224b
SUPRA_PULL=0x16f70cAD28dd621b0072B5A8a8c392970E87C3dD
SUPRA_PROOF_API_URL=

# tokens
USDT=0xF1B50eD67A9e2CC94Ad3c477779E2d4cBfFf9029
USDC_E=0x054ed45810DbBAb8B27668922D110669c9D88D0a

# backend
DATABASE_URL=
KEY_SERVICE_MASTER_KEY=  # 32 bytes, encrypts AES keys at rest
INTERNAL_SECRET=
ANTHROPIC_API_KEY=

# telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
MINI_APP_URL=

# web
NEXT_PUBLIC_API_URL=
NEXT_PUBLIC_REOWN_PROJECT_ID=
```
Never commit `.env`; keep a `.env.example` with these names only.
