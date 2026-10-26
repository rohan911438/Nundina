import { createConfig } from "ponder";
import { deployment, type ContractName } from "@nundina/shared";
import {
  identityRegistryAbi,
  outcomeResolverAbi,
  performanceEscrowAbi,
  providerRegistryAbi,
  reputationRegistryAbi,
  revenueRouterAbi,
  signalBookAbi,
} from "@nundina/shared/abis";

/**
 * One chain per indexer process, chosen by INDEXER_CHAIN_ID (falls back to CHAIN_ID):
 * 177 = HashKey mainnet, 133 = testnet, 31337 = local anvil. Addresses and start block come from
 * packages/shared/src/addresses.json (written by `pnpm contracts:export`).
 */
const chainId = Number(process.env.INDEXER_CHAIN_ID ?? process.env.CHAIN_ID ?? 133);
const rpc =
  chainId === 177
    ? (process.env.HSK_RPC_URL ?? "https://mainnet.hsk.xyz")
    : chainId === 31337
      ? (process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545")
      : (process.env.HSK_TESTNET_RPC_URL ?? "https://testnet.hsk.xyz");

const d = deployment(chainId);
const ZERO = "0x0000000000000000000000000000000000000001";
const at = (name: ContractName) => d[name] ?? ZERO;
// INDEXER_START_BLOCK overrides the deployment block (fresh test chains are younger than the recorded one)
const startBlock = process.env.INDEXER_START_BLOCK ? Number(process.env.INDEXER_START_BLOCK) : (d.startBlock ?? 0);

export default createConfig({
  database: { kind: "postgres", connectionString: process.env.DATABASE_URL },
  chains: {
    hashkey: {
      id: chainId,
      rpc,
      pollingInterval: chainId === 31337 ? 500 : 1_000,
      // HashKey is an OP-stack L2; a few blocks is plenty locally
      ...(chainId === 31337 ? { reorgWindow: 2 } : {}),
      cacheRpcRequests: chainId !== 31337,
    },
  },
  contracts: {
    ProviderRegistry: { chain: "hashkey", abi: providerRegistryAbi, address: at("ProviderRegistry"), startBlock },
    SignalBook: { chain: "hashkey", abi: signalBookAbi, address: at("SignalBook"), startBlock },
    OutcomeResolver: { chain: "hashkey", abi: outcomeResolverAbi, address: at("OutcomeResolver"), startBlock },
    PerformanceEscrow: { chain: "hashkey", abi: performanceEscrowAbi, address: at("PerformanceEscrow"), startBlock },
    RevenueRouter: { chain: "hashkey", abi: revenueRouterAbi, address: at("RevenueRouter"), startBlock },
    IdentityRegistry: { chain: "hashkey", abi: identityRegistryAbi, address: at("IdentityRegistry"), startBlock },
    ReputationRegistry: { chain: "hashkey", abi: reputationRegistryAbi, address: at("ReputationRegistry"), startBlock },
  },
});
