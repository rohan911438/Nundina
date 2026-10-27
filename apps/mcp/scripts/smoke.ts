/**
 * Talks to a running server like any MCP client would.
 *   pnpm --filter @nundina/mcp exec tsx scripts/smoke.ts [http://localhost:8791/mcp] [nk_…]
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.argv[2] ?? "http://localhost:8791/mcp";
const key = process.argv[3];
const client = new Client({ name: "nundina-smoke", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: key ? { headers: { authorization: `Bearer ${key}` } } : undefined }));
const { tools } = await client.listTools();
console.log(`tools: ${tools.map((t) => t.name).join(", ")}`);
const show = (r: any) => JSON.stringify(r.structuredContent ?? r.content, null, 1).slice(0, 600);
console.log("list_providers →", show(await client.callTool({ name: "list_providers", arguments: { limit: 3, period: "all" } })));
console.log("get_signals →", show(await client.callTool({ name: "get_signals", arguments: { status: "settled", limit: 2 } })));
console.log("verify_track_record (no payment) →", show(await client.callTool({ name: "verify_track_record", arguments: { handle: "x" } })));
await client.close();
