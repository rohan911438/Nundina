"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { BuyFlow } from "@/components/flows/BuyFlow";
import Link from "next/link";
import { api } from "@/lib/api";
import { isBuyable } from "@/lib/signal-state";
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
      {!isBuyable(s) ? (
        <div className="rise rounded-2xl border border-border bg-surface p-5 text-sm">
          <p className="font-medium">Sales closed</p>
          <p className="mt-1 text-muted">
            {s.outcome || s.revealed
              ? "Its levels and result are public now."
              : "It expired before you bought it. The oracle is checking the result; nobody can buy it any more."}
          </p>
          <Link href="/tg/my" className="mt-3 inline-block text-accent">
            My signals →
          </Link>
        </div>
      ) : (
        <BuyFlow signal={s} provider={provider.data ?? null} onDone={() => setDone(true)} />
      )}
    </div>
  );
}
