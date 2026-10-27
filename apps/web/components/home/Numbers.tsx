import type { ApiStats } from "@nundina/shared";
import { CountUp } from "@/components/motion/CountUp";
import { Reveal } from "@/components/motion/Reveal";
import { int, usd } from "@/lib/format";

export function Numbers({ stats }: { stats: ApiStats | null }) {
  const items: [string, string][] = [
    ["Signals committed", int(stats?.signalsCommitted)],
    ["Payments settled", int(stats?.paymentsSettled)],
    ["Refunds paid", stats ? usd(stats.refundsPaid, { compact: true }) : "—"],
    ["Providers", int(stats?.providers)],
  ];
  return (
    <Reveal as="section" aria-label="Totals" className="mx-auto max-w-6xl px-4 sm:px-6">
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border lg:grid-cols-4">
        {items.map(([k, v]) => (
          <div key={k} className="bg-surface px-5 py-6 sm:px-6 sm:py-8">
            <dt className="text-xs text-muted sm:text-sm">{k}</dt>
            <dd className="num mt-2 text-3xl font-medium tracking-tight sm:text-5xl">
              <CountUp value={v} />
            </dd>
          </div>
        ))}
      </dl>
    </Reveal>
  );
}
