import type { ReactNode } from "react";
import { WalletProviders } from "@/components/wallet/WalletProviders";

export default function Layout({ children }: { children: ReactNode }) {
  return <WalletProviders>{children}</WalletProviders>;
}
