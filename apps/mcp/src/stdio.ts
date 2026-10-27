import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { env } from "./env.js";
import { createServer } from "./server.js";

/** Local use (Claude Desktop / Claude Code): acts with NUNDINA_API_KEY. Logs go to stderr only. */
const server = createServer({ apiKey: env().NUNDINA_API_KEY });
await server.connect(new StdioServerTransport());
console.error("nundina mcp (stdio) ready");
