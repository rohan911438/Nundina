import { defineChain, type Chain } from "viem";

/** Safe env access (works in Node and in browser bundles). */
const env: Record<string, string | undefined> =
  typeof process !== "undefined" && process.env ? process.env : {};

export const HASHKEY_MAINNET_ID = 177 as const;
/** Confirmed via eth_chainId on https://testnet.hsk.xyz (0x85). Overridable with env. */
export const HASHKEY_TESTNET_ID = Number(env.HSK_TESTNET_CHAIN_ID ?? 133);
export const LOCAL_CHAIN_ID = 31337 as const;

export const hashkeyMainnet = defineChain({
  id: HASHKEY_MAINNET_ID,
  name: "HashKey Chain",
  nativeCurrency: { name: "HashKey Platform Token", symbol: "HSK", decimals: 18 },
  rpcUrls: {
    default: { http: [env.HSK_RPC_URL ?? "https://mainnet.hsk.xyz"] },
  },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://hsk.blockscout.com" },
  },
});

export const hashkeyTestnet = defineChain({
  id: HASHKEY_TESTNET_ID,
  name: "HashKey Chain Testnet",
  nativeCurrency: { name: "HashKey Platform Token", symbol: "HSK", decimals: 18 },
  rpcUrls: {
    default: { http: [env.HSK_TESTNET_RPC_URL ?? "https://testnet.hsk.xyz"] },
  },
  blockExplorers: {
    // TODO(confirm): testnet explorer URL
    default: { name: "Blockscout", url: env.HSK_TESTNET_EXPLORER_URL ?? "https://testnet-explorer.hsk.xyz" },
  },
  testnet: true,
});

/** Local anvil chain used for development (pnpm chain:local). */
export const localChain = defineChain({
  id: LOCAL_CHAIN_ID,
  name: "Nundina Local",
  nativeCurrency: { name: "HashKey Platform Token", symbol: "HSK", decimals: 18 },
  rpcUrls: {
    default: { http: [env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545"] },
  },
  blockExplorers: {
    default: { name: "Local", url: "https://hsk.blockscout.com" },
  },
  testnet: true,
});

export const CHAINS: Record<number, Chain> = {
  [hashkeyMainnet.id]: hashkeyMainnet,
  [hashkeyTestnet.id]: hashkeyTestnet,
  [localChain.id]: localChain,
};

export function chainById(id: number): Chain {
  const c = CHAINS[id];
  if (!c) throw new Error(`Unsupported chainId ${id}`);
  return c;
}

export function explorerTx(chainId: number, hash: string) {
  return `${chainById(chainId).blockExplorers!.default.url}/tx/${hash}`;
}

export function explorerAddress(chainId: number, addr: string) {
  return `${chainById(chainId).blockExplorers!.default.url}/address/${addr}`;
}
