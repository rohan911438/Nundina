/**
 * One-off: register the MCP server's ERC-8004 identity (agentURI = its A2A card).
 *   MCP_IDENTITY_PRIVATE_KEY=0x… MCP_PUBLIC_URL=https://mcp.nundina.xyz pnpm --filter @nundina/mcp register-identity
 * Put the printed id in MCP_ERC8004_AGENT_ID so the card lists it.
 */
import type { Hex } from "viem";
import { explorerTx } from "@nundina/shared";
import { env } from "../src/env.js";
import { registerIdentity } from "../src/identity.js";

if (process.env.MCP_ERC8004_AGENT_ID) {
  console.log(`already registered as agent #${process.env.MCP_ERC8004_AGENT_ID}; unset MCP_ERC8004_AGENT_ID to register again`);
  process.exit(0);
}
const pk = process.env.MCP_IDENTITY_PRIVATE_KEY;
if (!pk) throw new Error("MCP_IDENTITY_PRIVATE_KEY is not set");
const r = await registerIdentity(pk as Hex);
console.log(`ERC-8004 agent #${r.agentId} → ${r.agentUri}\nregistry ${r.registry}\ntx ${explorerTx(env().CHAIN_ID, r.tx)}\n\nset MCP_ERC8004_AGENT_ID=${r.agentId}`);
