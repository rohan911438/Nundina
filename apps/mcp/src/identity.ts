import { createWalletClient, http, parseEventLogs, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { contractAddress } from "@nundina/shared";
import { identityRegistryAbi } from "@nundina/shared/abis";
import { env } from "./env.js";
import { chain, pub, rpcUrl } from "./chain.js";

/**
 * Registers this MCP server as an ERC-8004 agent whose agentURI is its A2A card
 * (`<MCP_PUBLIC_URL>/.well-known/agent.json`). Returns the new agent id and tx.
 */
export async function registerIdentity(privateKey: Hex, agentUri = `${env().MCP_PUBLIC_URL}/.well-known/agent.json`) {
  const account = privateKeyToAccount(privateKey);
  const p = pub();
  const wallet = createWalletClient({ account, chain: chain(), transport: http(rpcUrl()) });
  const registry = contractAddress(env().CHAIN_ID, "IdentityRegistry");
  const hash = await wallet.writeContract({ address: registry, abi: identityRegistryAbi, functionName: "register", args: [agentUri] });
  const rc = await p.waitForTransactionReceipt({ hash });
  const [ev] = parseEventLogs({ abi: identityRegistryAbi, eventName: "Registered", logs: rc.logs });
  if (!ev) throw new Error("Registered event missing");
  return { agentId: ev.args.agentId, tx: hash, agentUri, registry };
}
