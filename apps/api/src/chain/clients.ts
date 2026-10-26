import { createPublicClient, createWalletClient, http, type Account, type PublicClient, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainById, contractAddress, deployment, type ContractName } from "@nundina/shared";
import { env, rpcUrl } from "../env.js";

let pub: PublicClient | undefined;
let relayerWallet: WalletClient | undefined;

export function chain() {
  const c = chainById(env().CHAIN_ID);
  return { ...c, rpcUrls: { default: { http: [rpcUrl()] } } };
}

export function publicClient(): PublicClient {
  pub ??= createPublicClient({ chain: chain(), transport: http(rpcUrl(), { retryCount: 2, timeout: 15_000 }) });
  return pub;
}

export function relayerAccount(): Account | undefined {
  const pk = env().RELAYER_PRIVATE_KEY;
  return pk ? privateKeyToAccount(pk as `0x${string}`) : undefined;
}

export function relayerClient(): WalletClient {
  const account = relayerAccount();
  if (!account) throw new Error("RELAYER_PRIVATE_KEY is not configured");
  relayerWallet ??= createWalletClient({ account, chain: chain(), transport: http(rpcUrl()) });
  return relayerWallet;
}

export function addr(name: ContractName) {
  return contractAddress(env().CHAIN_ID, name);
}

export function deployed() {
  return deployment(env().CHAIN_ID);
}

/** Test hook: drop cached clients after env changes. */
export function resetClients() {
  pub = undefined;
  relayerWallet = undefined;
}
