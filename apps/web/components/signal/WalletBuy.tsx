"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { ApiSignalDetail } from "@nundina/shared";
import { BuyFlow } from "@/components/flows/BuyFlow";
import { WalletProviders } from "@/components/wallet/WalletProviders";
import { api } from "@/lib/api";

/** Wallet checkout on `/s/[id]`; loaded on demand so the public page ships no wallet code. */
export default function WalletBuy({ signal }: { signal: ApiSignalDetail }) {
  const router = useRouter();
  const provider = useQuery({
    queryKey: ["provider", signal.provider?.handle],
    queryFn: () => api.provider(signal.provider!.handle),
    enabled: Boolean(signal.provider?.handle),
  });
  return (
    <WalletProviders>
      <BuyFlow signal={signal} provider={provider.data ?? null} onDone={() => router.refresh()} />
    </WalletProviders>
  );
}
