# Prompt 14: MCP server for external AI agents

## Context
API, payments (07), indexer + scoring (08) exist. Read first:
- `Idea/04-why-hashkey.md` §4.2 (`x402Gate`, `@hsp/mcp`)
- `Idea/hsp-developer-guide.md` §6 (x402), §8
- `Idea/05-architecture.md` §5.3 MCP row
- `Architecture/03-backend.md` §3.2

## Goal
Any MCP-capable agent (Claude, OpenClaw, AgentKit-based agents) can discover providers, verify track records from on-chain data, and buy signals. Premium data calls are paid per call through HSP/x402.

## Architecture
```
apps/mcp/
├── src/
│   ├── index.ts            MCP server (@modelcontextprotocol/sdk), Streamable HTTP transport + stdio for local use
│   ├── tools/
│   │   ├── listProviders.ts
│   │   ├── getSignals.ts
│   │   ├── verifyTrackRecord.ts
│   │   ├── getSignal.ts
│   │   ├── buySignal.ts
│   │   └── getPurchase.ts
│   ├── paywall.ts          x402Gate wrapper for paid tools (HSP facilitator, USDC.e)
│   ├── auth.ts             agent API key or wallet-signed requests
│   └── nundina.ts          API client
└── README.md               install snippets for Claude Code / Claude Desktop / generic MCP clients
```

## Tools (input/output schemas in zod → JSON Schema)
| Tool | Paid? | Input | Output |
|---|---|---|---|
| `list_providers` | free | market?, minScore?, type?, limit | providers with score, n, Wilson LB, expectancy, price |
| `get_signals` | free | status (live/settled), market?, provider?, limit | signal summaries (no plaintext for live) |
| `get_signal` | free | id | detail + proofs + explorer links |
| `verify_track_record` | **paid** (e.g. 0.01 USDC.e) | provider handle | full settled history from chain + recomputed score using `packages/shared/scoring`, plus the list of tx hashes so the agent can check independently |
| `buy_signal` | pays the signal price via HSP | id, token, maxPrice | purchase id, status; when unlocked: encrypted key + ciphertext (the agent decrypts with its own key) |
| `get_purchase` | free | purchase id | status, HSP payment id, plaintext not included (agent decrypts) |

Tool descriptions must state clearly: what it costs, that results are not investment advice, and that `buy_signal` spends money.

## Payments
- **Paid data tools:** use `x402Gate` from `@hsp/sdk` (USDC.e, EIP-3009, facilitator from `HSP_FACILITATOR_URL`). If the facilitator isn't available, return a structured "payment required" error with the HSP payment instructions, and allow API-key accounts with prepaid credit (simple `credits` column on `agents`) as a fallback.
- **`buy_signal`:** two modes.
  1. **Delegated:** the agent passes its own signed mandate + tx hash (it pays with `@hsp/mcp` `hsp_pay` in its own environment). The server only calls `/purchases` + `/submit`.
  2. **Custodial demo mode** (off by default, testnet only): the server pays from a scoped demo wallet with SpendGuard caps. Clearly labelled.
- Enforce `maxPrice`; refuse if the signal price is higher.

## Discovery
- Publish an **A2A agent card** at `/.well-known/agent.json` (name, description, skills = tools, endpoint, payment info).
- Register the MCP server's ERC-8004 identity with `agentURI` pointing to that card.

## Tests
- Each tool's schema validation and happy path against the API in mock HSP mode.
- `verify_track_record` recomputed score equals `/providers/:handle` score.
- Paywall returns payment-required without payment and succeeds with a mocked facilitator receipt.
- End-to-end: configure Claude Code with this MCP server (`.mcp.json` example in README) and ask it to "find the best BTC provider and buy their live signal under 0.5 USDT" on testnet; capture the transcript for the demo.

## Done when
- [ ] Server reachable over HTTP; README has copy-paste config for Claude Code and a generic MCP client.
- [ ] The Claude Code end-to-end run works on testnet.
- [ ] Agent card + ERC-8004 registration done.

## Out of scope
New business logic: the MCP server only wraps the API.
