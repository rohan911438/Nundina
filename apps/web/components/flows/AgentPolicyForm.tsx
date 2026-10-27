"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { MARKETS } from "@nundina/shared/signal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { AgentView } from "@/lib/session";

export type Policy = AgentView["policy"];

export const DEFAULT_POLICY: Policy = {
  dailyBudgetUsd: "5",
  maxPerSignalUsd: "1",
  minScore: 60,
  markets: ["BTC/USD"],
  providersAllow: [],
  providersDeny: [],
  autoTrade: false,
  slippageBps: 50,
};

const handles = (s: string) =>
  s
    .split(/[\s,]+/)
    .map((h) => h.replace(/^@/, "").trim().toLowerCase())
    .filter(Boolean);
const money = /^\d+(\.\d{1,6})?$/;

/** Validates a policy; returns field → message. */
export function policyErrors(p: Policy): Partial<Record<keyof Policy, string>> {
  const e: Partial<Record<keyof Policy, string>> = {};
  if (!p.dailyBudgetUsd || !money.test(p.dailyBudgetUsd)) e.dailyBudgetUsd = "Enter an amount";
  if (!p.maxPerSignalUsd || !money.test(p.maxPerSignalUsd)) e.maxPerSignalUsd = "Enter an amount";
  else if (p.dailyBudgetUsd && money.test(p.dailyBudgetUsd) && Number(p.maxPerSignalUsd) > Number(p.dailyBudgetUsd)) e.maxPerSignalUsd = "Can't exceed the daily budget";
  if (p.minScore == null || p.minScore < 0 || p.minScore > 100) e.minScore = "0–100";
  if (!p.markets.length) e.markets = "Pick at least one market";
  if (p.slippageBps < 0 || p.slippageBps > 500) e.slippageBps = "0–500 bps";
  return e;
}

export function AgentPolicyForm({ initial, submitLabel, onSubmit }: { initial: Policy; submitLabel: string; onSubmit: (p: Policy) => Promise<void> }) {
  const [p, setP] = useState<Policy>(initial);
  const [allow, setAllow] = useState(initial.providersAllow.join(", "));
  const [deny, setDeny] = useState(initial.providersDeny.join(", "));
  const [busy, setBusy] = useState(false);
  const errs = policyErrors(p);
  const valid = Object.keys(errs).length === 0;

  return (
    <form
      className="space-y-4"
      data-testid="policy-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid) return;
        setBusy(true);
        try {
          await onSubmit({ ...p, providersAllow: handles(allow), providersDeny: handles(deny) });
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <L label="Daily budget (USD)" error={errs.dailyBudgetUsd}>
          <input inputMode="decimal" value={p.dailyBudgetUsd ?? ""} onChange={(e) => setP({ ...p, dailyBudgetUsd: e.target.value })} className="input num" />
        </L>
        <L label="Max per signal (USD)" error={errs.maxPerSignalUsd}>
          <input inputMode="decimal" value={p.maxPerSignalUsd ?? ""} onChange={(e) => setP({ ...p, maxPerSignalUsd: e.target.value })} className="input num" />
        </L>
        <L label="Min provider score" error={errs.minScore}>
          <input inputMode="numeric" value={p.minScore ?? ""} onChange={(e) => setP({ ...p, minScore: e.target.value === "" ? null : Number(e.target.value) })} className="input num" />
        </L>
      </div>
      <fieldset>
        <legend className="text-xs text-muted">Markets</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {Object.keys(MARKETS).map((m) => {
            const on = p.markets.includes(m);
            return (
              <button
                key={m}
                type="button"
                aria-pressed={on}
                onClick={() => setP({ ...p, markets: on ? p.markets.filter((x) => x !== m) : [...p.markets, m] })}
                className={cn("rounded-full border px-3 py-1 text-sm", on ? "border-accent bg-accent/10" : "border-border text-muted")}
              >
                {m}
              </button>
            );
          })}
        </div>
        {errs.markets ? <span className="mt-1 block text-xs text-loss">{errs.markets}</span> : null}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <L label="Only these providers (optional)">
          <input value={allow} onChange={(e) => setAllow(e.target.value)} placeholder="@alpha, @beta" className="input" />
        </L>
        <L label="Never these providers">
          <input value={deny} onChange={(e) => setDeny(e.target.value)} placeholder="@gamma" className="input" />
        </L>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={p.autoTrade} onChange={(e) => setP({ ...p, autoTrade: e.target.checked })} />
          Auto-trade on HSKSwap
        </label>
        <L label="Slippage cap (bps)" error={errs.slippageBps}>
          <input inputMode="numeric" value={p.slippageBps} disabled={!p.autoTrade} onChange={(e) => setP({ ...p, slippageBps: Number(e.target.value) || 0 })} className="input num w-28" />
        </L>
      </div>
      <Button type="submit" variant="accent" disabled={!valid || busy} data-testid="policy-submit">
        {busy ? <Loader2 aria-hidden className="animate-spin" /> : null}
        {submitLabel}
      </Button>
    </form>
  );
}

function L({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-muted">{label}</span>
      <div className="mt-1">{children}</div>
      {error ? <span className="mt-1 block text-xs text-loss">{error}</span> : null}
    </label>
  );
}
