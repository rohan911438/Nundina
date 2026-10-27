import { createPublicClient, createWalletClient, http, type Hex, type PrivateKeyAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainById } from "@nundina/shared/chain";
import { env } from "./env.js";

/**
 * Agent wallet. HashKey AgentKit is the target (TODO(confirm): no public AgentKit build for chain
 * 177/133 yet); until then a viem local account from the agent's own env key.
 */
export function agentWallet(privateKey: Hex) {
  const account: PrivateKeyAccount = privateKeyToAccount(privateKey);
  const chain = chainById(env().CHAIN_ID);
  const url = env().RPC_URL ?? (env().CHAIN_ID === 31337 ? env().LOCAL_RPC_URL : env().HSK_TESTNET_RPC_URL) ?? chain.rpcUrls.default.http[0];
  const transport = http(url);
  return {
    account,
    address: account.address,
    pub: createPublicClient({ chain, transport }),
    wallet: createWalletClient({ account, chain, transport }),
  };
}
export type AgentWallet = ReturnType<typeof agentWallet>;

/** Reads `AGENT_<NAME>_PRIVATE_KEY`; never logs it. */
export function keyFromEnv(name: string): Hex {
  const k = process.env[`AGENT_${name.toUpperCase().replace(/-/g, "_")}_PRIVATE_KEY`];
  if (!k || !/^0x[0-9a-fA-F]{64}$/.test(k)) throw new Error(`AGENT_${name.toUpperCase()}_PRIVATE_KEY is not set`);
  return k as Hex;
}
