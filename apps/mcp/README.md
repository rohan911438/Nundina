# Nundina MCP server

Lets any MCP client (Claude Code, Claude Desktop, OpenClaw, AgentKit agents) find signal providers, verify their track record against the chain, and buy signals. It only wraps the Nundina API.

- Streamable HTTP: `POST /mcp` (stateless, JSON responses). Default port 8791.
- stdio: `pnpm --filter @nundina/mcp stdio` (acts with `NUNDINA_API_KEY`).
- A2A agent card: `GET /.well-known/agent.json`. This URL is also the server's ERC-8004 `agentURI`.

Nothing returned is investment advice.

## Tools

| Tool | Cost | What it does |
|---|---|---|
| `list_providers` | free | Leaderboard: score, n, win rate, Wilson LB, expectancy, price, bond |
| `get_signals` | free | `live` (sealed, buyable) / `settled` / `revealed` summaries |
| `get_signal` | free | Detail, commit hash, oracle price, commit/reveal/resolve/settle txs + explorer links, HSP payment ids, upstream tree |
| `verify_track_record` | **0.01 USDC.e** per call | Re-reads every decided signal from SignalBook + OutcomeResolver, recomputes the score with `@nundina/shared` scoring, compares with what Nundina reports, lists every tx hash |
| `buy_signal` | **the signal's price** | Spends money. Two steps (below); refuses above `maxPrice` |
| `get_purchase` | free | Status, HSP payment id, txs (no plaintext) |

### Paying for `verify_track_record`
1. **x402**: pass `payment`, a base64 x402 `PaymentPayload` (`exact` scheme, USDC.e EIP-3009 authorization to `payTo`), either as a tool argument or as an `X-PAYMENT` header. The HSP facilitator (`HSP_FACILITATOR_URL`) verifies and settles it.
2. **Prepaid credit**: send your agent API key. Each call is debited from the key's credit.
3. Otherwise the tool returns `payment_required`, with the x402 `accepts` requirements in the result.

### Buying a signal (delegated, default)
1. `buy_signal {id, maxPrice, encryptionPublicKey?}` returns an HSP `mandate` (EIP-712) and the escrow `payee`. Nothing is spent at this step.
2. Sign the mandate with your wallet and transfer the amount to `payee` (for example with `@hsp/mcp` `hsp_pay` in your own environment).
3. `buy_signal {id, maxPrice, purchaseId, mandateSig, txHash}` returns `delivery` (`wrappedKey`, `ciphertext`, `iv`) once HSP has verified the payment.
4. Decrypt: ECIES-unwrap `wrappedKey` with your encryption private key, then AES-256-GCM-decrypt `ciphertext` with `iv`.

The payer is the wallet linked to your API key. If the signal loses, you get a refund from the escrow.

**Custodial demo mode** (`MCP_CUSTODIAL=true`, never on chain 177): calls without an API key are paid from a demo wallet (`MCP_DEMO_PRIVATE_KEY`), capped by `MCP_DEMO_MAX_PER_SIGNAL_UNITS` and `MCP_DEMO_DAILY_UNITS`, and return the plaintext. Results are labelled `custodial-demo`.

## Get an API key
Sign in on the web app, then call `POST /me/api-keys {"name":"my agent"}` (or use `/dashboard/agents`). The key (`nk_…`) is shown once. It pays from your wallet and decrypts with your encryption key.

## Install

**Claude Code** (`.mcp.json` in your project):
```json
{
  "mcpServers": {
    "nundina": {
      "type": "http",
      "url": "https://mcp.nundina.xyz/mcp",
      "headers": { "Authorization": "Bearer ${NUNDINA_API_KEY}" }
    }
  }
}
```
or `claude mcp add --transport http nundina https://mcp.nundina.xyz/mcp --header "Authorization: Bearer $NUNDINA_API_KEY"`.

**Claude Desktop** (`claude_desktop_config.json`, local stdio):
```json
{
  "mcpServers": {
    "nundina": {
      "command": "pnpm",
      "args": ["--dir", "/path/to/nundina", "--filter", "@nundina/mcp", "stdio"],
      "env": { "NUNDINA_API_KEY": "nk_…", "API_URL": "https://api.nundina.xyz" }
    }
  }
}
```

**Generic MCP client** (Streamable HTTP):
```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const client = new Client({ name: "my-agent", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL("https://mcp.nundina.xyz/mcp"), {
  requestInit: { headers: { Authorization: `Bearer ${process.env.NUNDINA_API_KEY}` } },
}));
console.log(await client.callTool({ name: "list_providers", arguments: { market: "BTC/USD", limit: 5 } }));
```

Try this prompt in Claude Code: *"Find the best BTC provider on Nundina, verify their track record, and buy their live signal if it costs under 0.5 USDT."*

## Run
```
pnpm --filter @nundina/mcp start          # HTTP on MCP_PORT (8791)
pnpm --filter @nundina/mcp stdio          # stdio
pnpm --filter @nundina/mcp exec tsx scripts/smoke.ts http://localhost:8791/mcp
pnpm --filter @nundina/mcp register-identity   # ERC-8004 identity → agent card (needs MCP_IDENTITY_PRIVATE_KEY)
```
Env: `API_URL`, `MCP_PUBLIC_URL`, `MCP_PORT`, `CHAIN_ID` + RPC, `VERIFY_PRICE_UNITS` (default 10000 = 0.01), `HSP_FACILITATOR_URL`, `MCP_PAY_TO`, `MCP_ERC8004_AGENT_ID`, and for custodial mode `MCP_CUSTODIAL`, `MCP_DEMO_PRIVATE_KEY`, `INTERNAL_SECRET`.

Tests (`pnpm --filter @nundina/mcp test`, anvil + the API in mock-HSP mode):
- schemas, and every tool's happy path
- `verify_track_record` recomputed from chain equals the API score, and catches a tampered DB
- payment-required, then credits, then x402 through a mocked facilitator
- delegated buy through to on-device decrypt
- ERC-8004 registration
