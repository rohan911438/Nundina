import { http, createConfig } from "wagmi";
import { injected } from "wagmi/connectors";
import { hashkeyMainnet, hashkeyTestnet, localChain } from "@nundina/shared/chain";
import { config } from "./config";

/**
 * Wallet config. Prompt 12 adds Reown AppKit (WalletConnect) on top once a project id is set;
 * the injected connector covers desktop wallets and in-app browsers until then.
 */
const chains =
  config.chainId === hashkeyMainnet.id
    ? ([hashkeyMainnet] as const)
    : config.chainId === localChain.id
      ? ([localChain] as const)
      : ([hashkeyTestnet] as const);

export const wagmiConfig = createConfig({
  chains,
  connectors: [injected()],
  transports: {
    [hashkeyMainnet.id]: http(),
    [hashkeyTestnet.id]: http(),
    [localChain.id]: http(),
  },
  ssr: true,
});
