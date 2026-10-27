import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ApiSignal } from "@nundina/shared";
import { Button } from "@/components/ui/button";
import { ProofCard } from "@/components/signal/ProofCard";

export function Hero({ latest }: { latest: ApiSignal | null }) {
  return (
    <section className="relative isolate overflow-hidden">
      <div aria-hidden className="bg-grid absolute inset-0 -z-10" />
      <div aria-hidden className="absolute inset-x-0 bottom-0 -z-10 h-1/2 bg-gradient-to-b from-transparent to-bg" />
      <div aria-hidden className="bg-glow absolute inset-0 -z-10" />
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-16 sm:px-6 sm:pt-24 lg:grid-cols-[1.25fr_1fr] lg:pb-24">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/70 px-3 py-1 text-xs text-muted">
            <span aria-hidden className="size-2 rounded-full bg-win shadow-[0_0_0_3px_color-mix(in_srgb,var(--win)_25%,transparent)]" />
            Settling on HashKey Chain through HSP
          </p>
          <h1 className="mt-6 text-balance text-[2.6rem] font-semibold leading-[1.02] tracking-[-0.035em] sm:text-6xl lg:text-7xl">
            Pay only when the call is <em className="font-display font-normal italic tracking-normal text-accent">right.</em>
          </h1>
          <p className="mt-6 max-w-xl text-pretty text-lg text-muted">
            Every signal is locked on-chain before the price moves. Your payment waits in escrow, and comes back automatically, with a slice of
            the provider&apos;s bond, when the call is wrong.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/leaderboard">
                See leaderboard <ArrowRight aria-hidden />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/start?role=provider">I&apos;m a provider</Link>
            </Button>
          </div>
        </div>
        <div className="rise [animation-delay:120ms]">{latest ? <ProofCard signal={latest} /> : null}</div>
      </div>
    </section>
  );
}
