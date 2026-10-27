import { Hono } from "hono";
import { cors } from "hono/cors";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { contractAddress, usdcE } from "@nundina/shared";
import { env } from "./env.js";
import { INSTRUCTIONS, SERVER_INFO, createServer, toolCatalog } from "./server.js";

/** A2A agent card (also the ERC-8004 agentURI of this server). */
export function agentCard() {
  const e = env();
  let identity: string | null = null;
  try {
    identity = contractAddress(e.CHAIN_ID, "IdentityRegistry");
  } catch {
    /* not deployed */
  }
  return {
    name: "Nundina signals",
    description: INSTRUCTIONS,
    version: SERVER_INFO.version,
    url: `${e.MCP_PUBLIC_URL}/mcp`,
    provider: { organization: "Nundina", url: e.WEB_ORIGIN.split(",")[0]!.trim() },
    protocols: { mcp: { transport: "streamable-http", endpoint: `${e.MCP_PUBLIC_URL}/mcp` } },
    authentication: { schemes: ["bearer"], description: "Agent API key (nk_…) from /dashboard/agents; free tools work without one." },
    skills: toolCatalog().map((t) => ({ id: t.name, name: t.title, description: t.description, tags: [t.paid ? "paid" : "free"] })),
    payments: {
      protocol: "x402",
      network: e.CHAIN_ID === 177 ? "hashkey" : e.CHAIN_ID === 133 ? "hashkey-testnet" : `eip155:${e.CHAIN_ID}`,
      asset: usdcE(e.CHAIN_ID),
      payTo: e.MCP_PAY_TO ?? null,
      facilitator: e.HSP_FACILITATOR_URL ?? null,
      signalPurchases: "HSP mandate + ERC-20 transfer into PerformanceEscrow (refund if the signal loses)",
    },
    registrations: identity ? [{ agentRegistry: `eip155:${e.CHAIN_ID}:${identity}`, agentId: process.env.MCP_ERC8004_AGENT_ID ?? null }] : [],
    disclaimer: "Not investment advice.",
  };
}

export function createHttpApp() {
  const app = new Hono();
  app.use("*", cors({ origin: "*", allowHeaders: ["authorization", "content-type", "mcp-session-id", "mcp-protocol-version", "x-payment"], exposeHeaders: ["mcp-session-id"] }));
  app.get("/health", (c) => c.json({ ok: true, name: SERVER_INFO.name, version: SERVER_INFO.version }));
  app.get("/.well-known/agent.json", (c) => c.json(agentCard()));
  app.get("/.well-known/agent-card.json", (c) => c.json(agentCard()));
  app.all("/mcp", async (c) => {
    const bearer = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
    const apiKey = bearer?.startsWith("nk_") ? bearer : undefined;
    if (bearer && !apiKey) return c.json({ error: "invalid_token", message: "Use a Nundina agent API key (nk_…)" }, 401);
    const server = createServer({ apiKey, header: (n) => c.req.header(n) });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    const res = await transport.handleRequest(c.req.raw, apiKey ? { authInfo: { token: apiKey, clientId: "nundina-agent", scopes: [] } } : undefined);
    void transport.close();
    return res;
  });
  return app;
}
