import { Lock } from "lucide-react";
import Link from "next/link";
import type { ApiSignal } from "@nundina/shared";
import { SignalStatusPill } from "@/components/signal/SignalStatusPill";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "@/components/ui/external";
import { cn } from "@/lib/cn";
import { explorer, r, usd, utc } from "@/lib/format";
import { isBuyable, signalState } from "@/lib/signal-state";

export function SignalHistory({ signals }: { signals: ApiSignal[] }) {
  if (!signals.length) return <p className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted">No signals yet.</p>;
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
      {signals.map((s) => {
        const st = signalState(s);
        const locked = st === "locked";
        return (
          <li
            key={s.id}
            data-testid="history-row"
            className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[12rem_1fr_auto_6rem_5rem] sm:gap-x-4 sm:px-5"
          >
            <div className="flex min-w-0 items-center gap-2 sm:col-start-2 sm:row-start-1">
              <span className="font-medium">{s.market}</span>
              {locked ? (
                <span className="inline-flex items-center gap-1 text-sm text-locked">
                  <Lock aria-hidden className="size-3.5" /> hidden
                </span>
              ) : (
                <span className={cn("text-sm", s.side === "LONG" ? "text-win" : s.side === "SHORT" ? "text-loss" : "text-muted")}>{s.side ?? "—"}</span>
              )}
            </div>
            <span className="justify-self-end sm:col-start-3 sm:row-start-1">
              <SignalStatusPill state={st} />
            </span>
            <Link href={`/s/${s.id}`} className="num row-start-2 text-xs text-muted hover:text-accent sm:col-start-1 sm:row-start-1 sm:text-sm">
              {utc(s.committedAt)}
            </Link>
            <span
              className={cn(
                "num col-start-2 row-start-2 text-right text-sm sm:col-start-4 sm:row-start-1 sm:text-base",
                st === "win" ? "text-win" : st === "loss" || st === "unrevealed" ? "text-loss" : "text-muted",
              )}
            >
              {locked ? usd(s.priceUsd) : r(s.rMultiple)}
            </span>
            <span className="hidden justify-self-end sm:col-start-5 sm:row-start-1 sm:block">
              {locked && isBuyable(s) ? (
                <Button asChild size="sm" variant="accent">
                  <Link href={`/s/${s.id}`}>Buy</Link>
                </Button>
              ) : s.tx.commit ? (
                <ExternalLink href={explorer.tx(s.tx.commit)} className="text-xs text-muted" label="Commit transaction on explorer">
                  commit
                </ExternalLink>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
