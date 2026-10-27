import { http, createConfig, type Config } from "wagmi";
import { injected, mock } from "wagmi/connectors";
import type { Address } from "viem";
import { hashkeyMainnet, hashkeyTestnet, localChain } from "@nundina/shared/chain";
import { config } from "./config";

/**
 * Wallet config. With `NEXT_PUBLIC_REOWN_PROJECT_ID` set, `WalletProviders` builds a Reown AppKit
 * (WalletConnect + mobile deep links, needed inside Telegram) on top of this chain list; without it
 * the injected connector covers desktop extensions and wallet in-app browsers.
 * `NEXT_PUBLIC_E2E_WALLET` adds wagmi's mock connector for an (unlocked) anvil account in tests.
 */
export const appChain = config.chainId === hashkeyMainnet.id ? hashkeyMainnet : config.chainId === localChain.id ? localChain : hashkeyTestnet;
export const chains = [appChain] as const;
export const reownProjectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? "";
const e2eWallet = process.env.NEXT_PUBLIC_E2E_WALLET as Address | undefined;

export const transports = {
  [hashkeyMainnet.id]: http(),
  [hashkeyTestnet.id]: http(),
  [localChain.id]: http(),
};

export const baseConnectors = () => [
  ...(e2eWallet ? [mock({ accounts: [e2eWallet], features: { reconnect: true } })] : []),
  injected(),
];

export const wagmiConfig: Config = createConfig({
  chains,
  connectors: baseConnectors(),
  transports,
  ssr: true,
});
