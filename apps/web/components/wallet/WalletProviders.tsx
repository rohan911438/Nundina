"use client";

import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { walletConfig } from "@/lib/wallet/appkit";

/** Wraps wallet routes (dashboards, Mini App) in wagmi; relies on the root QueryClientProvider. */
export function WalletProviders({ children }: { children: ReactNode }) {
  const [cfg] = useState(walletConfig);
  return (
    <WagmiProvider config={cfg} reconnectOnMount>
      {children}
    </WagmiProvider>
  );
}
