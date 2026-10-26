"use client";

import type { ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";

/** Wraps wallet routes (dashboards, Mini App) in wagmi; relies on the root QueryClientProvider. */
export function WalletProviders({ children }: { children: ReactNode }) {
  return <WagmiProvider config={wagmiConfig}>{children}</WagmiProvider>;
}
