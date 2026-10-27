import { serve } from "@hono/node-server";
import { env } from "./env.js";
import { createHttpApp } from "./http.js";

const { MCP_PORT, MCP_PUBLIC_URL, API_URL } = env();
serve({ fetch: createHttpApp().fetch, port: MCP_PORT }, () => {
  console.log(`nundina mcp on :${MCP_PORT} (${MCP_PUBLIC_URL}/mcp) → API ${API_URL}`);
});
