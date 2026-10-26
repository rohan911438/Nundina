import { defineChain } from "viem";

export const HASHKEY_MAINNET_ID = 177 as const;
/** Confirmed via eth_chainId on https://testnet.hsk.xyz (0x85). Overridable with env. */
export const HASHKEY_TESTNET_ID = Number(process.env.HSK_TESTNET_CHAIN_ID ?? 133);

export const hashkeyMainnet = defineChain({
  id: HASHKEY_MAINNET_ID,
  name: "HashKey Chain",
  nativeCurrency: { name: "HashKey Platform Token", symbol: "HSK", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.HSK_RPC_URL ?? "https://mainnet.hsk.xyz"] },
  },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://hashkey.blockscout.com" },
  },
});

export const hashkeyTestnet = defineChain({
  id: HASHKEY_TESTNET_ID,
  name: "HashKey Chain Testnet",
  nativeCurrency: { name: "HashKey Platform Token", symbol: "HSK", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.HSK_TESTNET_RPC_URL ?? "https://testnet.hsk.xyz"] },
  },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://testnet-explorer.hsk.xyz" },
  },
  testnet: true,
});

export const CHAINS = {
  [hashkeyMainnet.id]: hashkeyMainnet,
  [hashkeyTestnet.id]: hashkeyTestnet,
} as const;

export function chainById(id: number) {
  const c = (CHAINS as Record<number, typeof hashkeyMainnet>)[id];
  if (!c) throw new Error(`Unsupported chainId ${id}`);
  return c;
}

export function explorerTx(chainId: number, hash: string) {
  return `${chainById(chainId).blockExplorers!.default.url}/tx/${hash}`;
}

export function explorerAddress(chainId: number, addr: string) {
  return `${chainById(chainId).blockExplorers!.default.url}/address/${addr}`;
}
