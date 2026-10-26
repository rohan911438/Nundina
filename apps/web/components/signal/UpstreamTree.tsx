import Link from "next/link";
import type { ApiSignalDetail } from "@nundina/shared";
import { r } from "@/lib/format";
import { signalState } from "@/lib/signal-state";
import { SignalStatusPill } from "./SignalStatusPill";

/** Aggregator signals: which upstream signals it bought, the payout share each gets, and how each did. */
export function UpstreamTree({ tree }: { tree: ApiSignalDetail["upstreamTree"] }) {
  if (!tree.length) return null;
  return (
    <ul className="space-y-2" aria-label="Upstream signals">
      {tree.map((u) => (
        <li key={`${u.depth}-${u.id}`} style={{ marginLeft: `${(u.depth - 1) * 1.25}rem` }} className="relative">
          {u.depth > 1 ? <span aria-hidden className="absolute -left-3 top-0 h-1/2 w-2.5 rounded-bl-md border-b border-l border-border" /> : null}
          <Link href={`/s/${u.id}`} className="flex items-center gap-3 rounded-xl border border-border bg-surface-2/50 px-3 py-2 text-sm hover:border-accent/40">
            <span className="num w-14 shrink-0 text-muted">{(u.bps / 100).toFixed(u.bps % 100 ? 1 : 0)}%</span>
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">#{u.id}</span>{" "}
              <span className="text-muted">{u.signal?.provider ? `@${u.signal.provider.handle}` : "unknown signal"}</span>
            </span>
            {u.signal ? (
              <>
                <span className="num hidden text-muted sm:inline">{u.signal.rMultiple == null ? "" : r(u.signal.rMultiple)}</span>
                <SignalStatusPill state={signalState(u.signal)} />
              </>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}
