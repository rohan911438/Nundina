"use client";

import { Lock } from "lucide-react";
import { useMemo } from "react";
import type { ApiSignalDetail } from "@nundina/shared";
import { cn } from "@/lib/cn";
import { price } from "@/lib/format";
import { useUnlockedSignal } from "@/lib/unlock";
import { PriceChart, type ChartLevels } from "./PriceChart";

type S = Pick<
  ApiSignalDetail,
  "id" | "market" | "side" | "entry" | "takeProfit" | "stopLoss" | "revealed" | "committedAt" | "decidedAt" | "validUntil" | "outcome" | "oraclePriceAtCommit"
>;

/**
 * Levels + chart. Public once revealed; before that, only a viewer who bought the signal sees them
 * (decrypted client-side, prompt 12). Everyone else gets lock placeholders and a bare chart.
 */
export function SignalLevels({ s, now }: { s: S; now: number }) {
  const unlocked = useUnlockedSignal(s.id);
  const levels = useMemo<(ChartLevels & { side: "LONG" | "SHORT" | null }) | null>(
    () => (s.revealed ? { side: s.side, entry: s.entry, takeProfit: s.takeProfit, stopLoss: s.stopLoss } : unlocked),
    [s.revealed, s.side, s.entry, s.takeProfit, s.stopLoss, unlocked],
  );

  const committed = Date.parse(s.committedAt);
  const decided = s.decidedAt ? Date.parse(s.decidedAt) : null;
  const end = decided ?? Math.min(now, Date.parse(s.validUntil));
  const pad = Math.max((end - committed) * 0.15, 30 * 60_000);

  const cells: [string, string | null, string?][] = [
    ["Side", levels?.side ?? null, levels?.side === "LONG" ? "text-win" : "text-loss"],
    ["Entry", levels ? price(levels.entry, s.market) : null],
    ["Take profit", levels ? price(levels.takeProfit, s.market) : null, "text-win"],
    ["Stop loss", levels ? price(levels.stopLoss, s.market) : null, "text-loss"],
  ];

  return (
    <div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4" data-testid="levels">
        {cells.map(([k, v, tone]) => (
          <div key={k} className="bg-surface px-4 py-3">
            <dt className="text-xs text-muted">{k}</dt>
            <dd className={cn("num mt-1 text-lg font-medium", v && tone)}>
              {v ?? (
                <span className="inline-flex items-center gap-1.5 text-locked">
                  <Lock aria-hidden className="size-4" />
                  <span className="text-sm">locked</span>
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-4">
        <PriceChart
          market={s.market}
          from={Math.floor(committed - pad)}
          to={Math.floor(Math.min(now, end + pad))}
          committedAt={committed}
          touchAt={decided}
          touchWin={s.outcome == null ? null : s.outcome === "WIN"}
          levels={levels}
        />
      </div>
    </div>
  );
}
