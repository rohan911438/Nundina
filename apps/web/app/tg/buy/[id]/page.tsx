"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { BuyFlow } from "@/components/flows/BuyFlow";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import type { ApiProviderDetail } from "@nundina/shared";
import { api } from "@/lib/api";
import { ago, pct, usd } from "@/lib/format";
import { isBuyable } from "@/lib/signal-state";
import { haptic, useBackButton, useMainButton, useTelegram } from "@/lib/telegram";

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
  // opened straight from a bot button there is no history to go back to: close instead
  useBackButton(useCallback(() => (window.history.length > 1 ? router.back() : tg.close()), [router, tg]));
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
        <>
          <Summary priceUsd={s.priceUsd} validUntil={s.validUntil} buyers={s.purchaseCount} provider={provider.data ?? null} handle={s.provider?.handle} />
          <BuyFlow signal={s} provider={provider.data ?? null} onDone={() => (haptic.success(), setDone(true))} />
        </>
      )}
    </div>
  );
}

/** What you get, before any wallet prompt: who, how good, how much, how long, and the refund rule. */
function Summary({ priceUsd, validUntil, buyers, provider, handle }: { priceUsd: string; validUntil: string; buyers: number; provider: ApiProviderDetail | null; handle?: string }) {
  const sc = provider?.score;
  return (
    <div className="rise rounded-2xl border border-border bg-surface p-4 text-sm" data-testid="tg-buy-summary">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-medium">@{handle ?? "provider"}</p>
        <p className="num text-xl font-semibold">{Number(priceUsd) > 0 ? usd(priceUsd) : "Free"}</p>
      </div>
      <p className="mt-1 text-muted">
        {sc && sc.n > 0 ? `${pct(sc.winRate)} right over ${sc.n} settled` : "New provider, no settled signals yet"}
        {sc?.score != null ? ` · score ${Math.round(sc.score)}` : ""} · ends {ago(validUntil)}
        {buyers ? ` · ${buyers} bought` : ""}
      </p>
      <p className="mt-3 flex items-start gap-2 rounded-xl bg-win/[0.07] px-3 py-2 text-xs text-win">
        <ShieldCheck aria-hidden className="mt-px size-4 shrink-0" />
        Wrong call? Your payment comes back automatically from escrow.
      </p>
    </div>
  );
}
