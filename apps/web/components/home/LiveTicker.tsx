"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { ApiPage, ApiSignal } from "@nundina/shared";
import { api, SETTLED_STATUSES } from "@/lib/api";
import { cn } from "@/lib/cn";
import { marketShort, r } from "@/lib/format";
import { signalState } from "@/lib/signal-state";

/** Last 10 settled signals, refreshed every 30 s. Server-rendered first so there's no layout shift. */
export function LiveTicker({ initial }: { initial: ApiPage<ApiSignal> }) {
  const { data } = useQuery({
    queryKey: ["signals", "settled", 10],
    queryFn: () => api.signals({ status: SETTLED_STATUSES, limit: 10 }),
    initialData: initial,
    refetchInterval: 30_000,
  });
  const items = data.items;
  if (!items.length) return null;
  return (
    <section aria-label="Recently settled signals" className="border-y border-border bg-surface/50">
      <div className="relative flex h-12 items-center overflow-hidden">
        {/* edge fades as overlays (a mask would repaint the whole strip every frame) */}
        <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-bg to-transparent" />
        <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-bg to-transparent" />
        {/* rendered twice for a seamless loop; the copy is hidden from screen readers */}
        <ul className="animate-marquee flex w-max shrink-0 items-center will-change-transform">
          {[...items, ...items].map((s, i) => (
            <TickerItem key={`${s.id}-${i}`} s={s} hidden={i >= items.length} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function TickerItem({ s, hidden }: { s: ApiSignal; hidden: boolean }) {
  const st = signalState(s);
  const win = st === "win";
  const neutral = st === "void" || st === "refunded";
  return (
    <li aria-hidden={hidden || undefined} className="flex items-center">
      <Link href={`/s/${s.id}`} tabIndex={hidden ? -1 : undefined} className="flex items-center gap-2 px-5 text-sm hover:text-accent">
        <span aria-label={win ? "win" : neutral ? st : "loss"} className={cn("font-bold", win ? "text-win" : neutral ? "text-void" : "text-loss")}>
          {win ? "✓" : neutral ? "–" : "✕"}
        </span>
        <span className="font-medium">{marketShort(s.market)}</span>
        <span className={cn("num", win ? "text-win" : neutral ? "text-void" : "text-loss")}>{r(s.rMultiple)}</span>
        <span className="text-muted">{s.provider?.handle ? `@${s.provider.handle}` : ""}</span>
      </Link>
      <span aria-hidden className="text-border">/</span>
    </li>
  );
}
