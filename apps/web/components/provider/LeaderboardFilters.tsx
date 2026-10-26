"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { cn } from "@/lib/cn";
import { filterQuery, MARKET_OPTIONS, PERIODS, TYPES, type Filters } from "@/lib/leaderboard";

/** Every change rewrites the URL query; the server page re-renders from it. */
export function LeaderboardFilters({ value }: { value: Filters }) {
  const router = useRouter();
  const path = usePathname();
  const [pending, start] = useTransition();
  const set = (patch: Partial<Filters>) => start(() => router.replace(`${path}${filterQuery({ ...value, ...patch })}`, { scroll: false }));

  return (
    <div data-pending={pending || undefined} className="flex flex-wrap items-center gap-2 transition-opacity data-[pending]:opacity-60">
      <Segmented
        label="Market"
        options={[{ v: undefined, l: "All markets" }, ...MARKET_OPTIONS.map((m) => ({ v: m, l: m.split("/")[0]! }))]}
        value={value.market}
        onChange={(market) => set({ market })}
      />
      <Segmented label="Period" options={PERIODS.map((p) => ({ v: p, l: p === "all" ? "All time" : p }))} value={value.period} onChange={(period) => set({ period: period ?? "30d" })} />
      <Segmented
        label="Type"
        options={[{ v: undefined, l: "All" }, ...TYPES.map((t) => ({ v: t, l: t[0]!.toUpperCase() + t.slice(1) }))]}
        value={value.type}
        onChange={(type) => set({ type })}
      />
      <Toggle label="Verified only" on={value.verified} onChange={(verified) => set({ verified })} />
      <Toggle label="Include observed" on={value.observed} onChange={(observed) => set({ observed })} />
    </div>
  );
}

function Segmented<T extends string | undefined>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { v: T; l: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-full border border-border bg-surface p-0.5">
      {options.map((o) => {
        const active = o.v === value;
        return (
          <button
            key={o.l}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.v)}
            className={cn("h-8 rounded-full px-3 text-sm transition-colors", active ? "bg-text text-bg" : "text-muted hover:text-text")}
          >
            {o.l}
          </button>
        );
      })}
    </div>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-full border px-3 text-sm transition-colors",
        on ? "border-accent/50 bg-accent/10 text-text" : "border-border bg-surface text-muted hover:text-text",
      )}
    >
      <span aria-hidden className={cn("relative h-4 w-7 rounded-full transition-colors", on ? "bg-accent" : "bg-border")}>
        <span className={cn("absolute top-0.5 size-3 rounded-full bg-bg transition-[left]", on ? "left-3.5" : "left-0.5")} />
      </span>
      {label}
    </button>
  );
}
