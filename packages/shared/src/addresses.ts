import type { Address } from "viem";
import deployed from "./addresses.json" with { type: "json" };

/** External addresses on HashKey mainnet (chain 177). */
export const EXTERNAL = {
  aproBtcUsd: "0x204ED500ab56A2E19B051561258E3A45c850360F",
  aproHskUsd: "0x86CE42c1b714149Dc3A7b17169EF67b5F78A224b",
  supraPull: "0x16f70cAD28dd621b0072B5A8a8c392970E87C3dD",
  supraStorage: "0x58e158c74DF7Ad6396C0dcbadc4878faC9e93d57",
  usdt: "0xF1B50eD67A9e2CC94Ad3c477779E2d4cBfFf9029",
  usdcE: "0x054ed45810DbBAb8B27668922D110669c9D88D0a",
} as const satisfies Record<string, Address>;

export const TOKENS = {
  USDT: { address: EXTERNAL.usdt, decimals: 6, eip3009: false, symbol: "USDT" },
  USDC_E: { address: EXTERNAL.usdcE, decimals: 6, eip3009: true, symbol: "USDC.e" },
} as const;

export type ContractName =
  | "Timelock"
  | "IdentityRegistry"
  | "ReputationRegistry"
  | "ProviderRegistry"
  | "OutcomeResolver"
  | "PushPriceAdapter"
  | "AproPushAdapter"
  | "SupraPushAdapter"
  | "TouchVerifier"
  | "SignalBook"
  | "RevenueRouter"
  | "SignerCreditVerifier"
  | "PerformanceEscrow";

export type Deployment = Partial<Record<ContractName, Address>> & {
  startBlock?: number;
  tokens?: Partial<Record<"USDT" | "USDC_E", Address>>;
};

const table = deployed as Record<string, Deployment>;

export function deployment(chainId: number): Deployment {
  return table[String(chainId)] ?? {};
}

export function contractAddress(chainId: number, name: ContractName): Address {
  const a = deployment(chainId)[name];
  if (!a) throw new Error(`${name} not deployed on chain ${chainId} (packages/shared/src/addresses.json)`);
  return a;
}

/** Payment token for a chain: deployed mock on testnet/local if present, else mainnet USDT. */
export function paymentToken(chainId: number): Address {
  return deployment(chainId).tokens?.USDT ?? EXTERNAL.usdt;
}

/** USDC.e (EIP-3009) for a chain. */
export function usdcE(chainId: number): Address {
  return deployment(chainId).tokens?.USDC_E ?? EXTERNAL.usdcE;
}

/** True if the chain has a Nundina deployment in addresses.json. */
export function isDeployed(chainId: number): boolean {
  return Boolean(deployment(chainId).SignalBook);
}
