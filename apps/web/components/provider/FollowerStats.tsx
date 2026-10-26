import type { ApiScore, ApiSignal } from "@nundina/shared";
import { Stat } from "@/components/ui/card";
import { int, pp, tone } from "@/lib/format";
import { signalState } from "@/lib/signal-state";

/** What buyers actually got, from the settled history rather than the provider's claims. */
export function FollowerStats({ score, signals }: { score: ApiScore; signals: ApiSignal[] }) {
  let bought = 0;
  let refunded = 0;
  for (const s of signals) {
    bought += s.purchaseCount;
    const st = signalState(s);
    if (st === "loss" || st === "unrevealed" || st === "refunded") refunded += s.purchaseCount;
  }
  return (
    <dl className="grid grid-cols-3 gap-6">
      <Stat label="Paid unlocks" value={int(bought)} hint="across these signals" />
      <Stat label="Refunded" value={int(refunded)} hint={bought ? `${Math.round((refunded / bought) * 100)}% of buys` : "—"} />
      <Stat label="Avg follower PnL" value={pp(score.followerPnl)} tone={tone(score.followerPnl)} hint="after fees" />
    </dl>
  );
}
