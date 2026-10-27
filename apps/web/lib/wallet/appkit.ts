"use client";

import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { createAppKit } from "@reown/appkit/react";
import type { Config } from "wagmi";
import { config } from "@/lib/config";
import { appChain, baseConnectors, reownProjectId, transports, wagmiConfig } from "@/lib/wagmi";

/**
 * Reown AppKit with HashKey as a custom network. Built once, only in the browser, and only when a
 * project id is configured; otherwise the plain wagmi config (injected wallets) is used.
 */
let adapter: WagmiAdapter | null = null;
let kit: ReturnType<typeof createAppKit> | null = null;

export function walletConfig(): Config {
  if (!reownProjectId || typeof window === "undefined") return wagmiConfig;
  if (!adapter) {
    adapter = new WagmiAdapter({
      projectId: reownProjectId,
      networks: [appChain],
      transports,
      connectors: baseConnectors(),
      ssr: true,
    });
    kit = createAppKit({
      adapters: [adapter],
      projectId: reownProjectId,
      networks: [appChain],
      defaultNetwork: appChain,
      metadata: {
        name: "Nundina",
        description: "Pay only when the call is right",
        url: config.siteUrl,
        icons: [`${config.siteUrl}/icon.svg`],
      },
      features: { analytics: false, email: false, socials: false, swaps: false, onramp: false },
      themeVariables: { "--w3m-accent": "#7c8cff", "--w3m-border-radius-master": "2px" },
    });
  }
  return adapter.wagmiConfig as unknown as Config;
}

export const hasAppKit = () => Boolean(reownProjectId);

/** Opens the AppKit wallet picker; false when AppKit is not configured. */
export async function openAppKit() {
  walletConfig();
  if (!kit) return false;
  await kit.open();
  return true;
}
