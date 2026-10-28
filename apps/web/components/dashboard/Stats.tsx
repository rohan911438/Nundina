import type { CSSProperties, ReactNode } from "react";
import { CountUp } from "@/components/motion/CountUp";
import { cn } from "@/lib/cn";

/** A row of headline numbers that count up on first view. */
export function Stats({ items, className }: { items: readonly { k: string; v: string; tone?: string; hint?: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("grid gap-px overflow-hidden rounded-2xl border border-border bg-border", className)} style={{ gridTemplateColumns: `repeat(${Math.min(items.length, 4)}, minmax(0, 1fr))` }}>
      {items.map((x, i) => (
        <div key={x.k} className="rise bg-surface p-4" style={{ animationDelay: `${i * 60}ms` }}>
          <dt className="text-xs text-muted">{x.k}</dt>
          <dd className={cn("num mt-1 text-xl font-medium sm:text-2xl", x.tone)}>
            <CountUp value={x.v} />
          </dd>
          {x.hint ? <p className="mt-1 text-xs text-muted">{x.hint}</p> : null}
        </div>
      ))}
    </dl>
  );
}

/** Stagger style for list rows: the first few rows arrive one after another, the rest at once. */
export const rowIn = (i: number): CSSProperties => ({ animationDelay: `${Math.min(i, 8) * 40}ms` });

/** Placeholder shaped like a dashboard: a stat row and a list. */
export function DashSkeleton({ stats = 3 }: { stats?: number }) {
  return (
    <div aria-hidden className="space-y-6">
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${stats}, minmax(0, 1fr))` }}>
        {Array.from({ length: stats }, (_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-2xl bg-surface" />
        ))}
      </div>
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-xl bg-surface" style={{ animationDelay: `${i * 120}ms` }} />
        ))}
      </div>
    </div>
  );
}
