import Link from "next/link";
import type { ApiSignal } from "@nundina/shared";
import { hhmm, price, r, short, usd, utc } from "@/lib/format";
import { signalState } from "@/lib/signal-state";
import { cn } from "@/lib/cn";
import { SignalStatusPill } from "./SignalStatusPill";

/** A settled signal as a receipt: what was committed, when, and how it ended. Used in the hero. */
export function ProofCard({ signal: s }: { signal: ApiSignal }) {
  const st = signalState(s);
  const rows: [string, React.ReactNode][] = [
    ["Committed", <span key="c">{utc(s.committedAt)}</span>],
    ["Commit hash", <span key="h">{short(s.commitHash, 10, 6)}</span>],
    ["Entry", price(s.entry, s.market)],
    ["Take profit", price(s.takeProfit, s.market)],
    ["Stop loss", price(s.stopLoss, s.market)],
    ["Price paid", usd(s.priceUsd)],
  ];
  return (
    <Link
      href={`/s/${s.id}`}
      className="group block rounded-3xl border border-border bg-surface p-1.5 shadow-[0_30px_80px_-40px_var(--glow)] transition-transform duration-300 hover:-translate-y-0.5"
    >
      <div className="rounded-[1.1rem] border border-border/70 bg-bg/40 p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs uppercase tracking-wider text-muted">Latest settled call</p>
          <SignalStatusPill state={st} />
        </div>
        <div className="mt-5 flex items-end justify-between gap-4">
          <div>
            <p className="text-2xl font-semibold tracking-tight">
              {s.market} <span className={cn(s.side === "LONG" ? "text-win" : "text-loss")}>{s.side ?? ""}</span>
            </p>
            <p className="mt-1 text-sm text-muted">by {s.provider?.displayName ?? "unknown"}</p>
          </div>
          <p className={cn("num text-3xl font-medium", st === "win" ? "text-win" : st === "void" || st === "refunded" ? "text-void" : "text-loss")}>
            {r(s.rMultiple)}
          </p>
        </div>
        <dl className="mt-5 divide-y divide-dashed divide-border border-y border-dashed border-border text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-4 py-2">
              <dt className="text-muted">{k}</dt>
              <dd className="num">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs text-muted">
          Locked at {hhmm(s.committedAt)}, before the move.{" "}
          <span className="text-accent underline-offset-4 group-hover:underline">See the proof →</span>
        </p>
      </div>
    </Link>
  );
}
