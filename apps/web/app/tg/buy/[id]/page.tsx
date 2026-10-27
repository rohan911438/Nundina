"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { BuyFlow } from "@/components/flows/BuyFlow";
import { api } from "@/lib/api";
import { useBackButton, useMainButton, useTelegram } from "@/lib/telegram";

export default function TgBuy() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const tg = useTelegram();
  const [done, setDone] = useState(false);
  const signal = useQuery({ queryKey: ["signal", id], queryFn: () => api.signal(id) });
  const provider = useQuery({
    queryKey: ["provider", signal.data?.provider?.handle],
    queryFn: () => api.provider(signal.data!.provider!.handle),
    enabled: Boolean(signal.data?.provider?.handle),
  });
  useBackButton(useCallback(() => router.back(), [router]));
  useMainButton(done ? "Done" : null, tg.close);

  if (signal.isPending) return <div className="h-96 animate-pulse rounded-2xl bg-surface" />;
  if (signal.error) return <p role="alert" className="text-sm text-loss">{signal.error.message}</p>;
  const s = signal.data;
  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-xl font-semibold">
        {s.market} signal <span className="text-muted">#{s.id}</span>
      </h1>
      {s.outcome || s.revealed ? (
        <p className="text-sm text-muted">This signal is closed. Its levels and result are public on the signal page.</p>
      ) : (
        <BuyFlow signal={s} provider={provider.data ?? null} onDone={() => setDone(true)} />
      )}
    </div>
  );
}
