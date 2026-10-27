import type { Address } from "viem";
import { contractAddress, paymentToken, usdcE, type ContractName } from "@nundina/shared/addresses";
import { config } from "./config";

/** Deployed address on the app's chain, or null when this chain has no deployment yet. */
export function addr(name: ContractName): Address | null {
  try {
    return contractAddress(config.chainId, name);
  } catch {
    return null;
  }
}

export const TOKENS = {
  USDT: { key: "USDT" as const, symbol: "USDT", address: () => paymentToken(config.chainId), eip3009: false },
  USDC_E: { key: "USDC_E" as const, symbol: "USDC.e", address: () => usdcE(config.chainId), eip3009: true },
};
export type TokenKey = keyof typeof TOKENS;

export const fastPathEnabled = process.env.NEXT_PUBLIC_FAST_PATH_ENABLED === "true";
