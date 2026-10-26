import type { ApiScore } from "@nundina/shared";
import { Stat } from "@/components/ui/card";
import { pct, pp, r, tone } from "@/lib/format";

export function ScorePanel({ s }: { s: ApiScore }) {
  return (
    <div className="grid gap-6 sm:grid-cols-[auto_1fr] sm:items-center">
      <div className="flex items-baseline gap-3 sm:flex-col sm:items-start sm:gap-1 sm:border-r sm:border-border sm:pr-8">
        <span className="text-xs text-muted">Score</span>
        <span className="num text-6xl font-medium leading-none tracking-tight">{s.score == null ? "—" : s.score.toFixed(0)}</span>
        <span className="text-xs text-muted">{s.probation ? `Probation · ${30 - s.n} more to rank` : "out of 100 · all time"}</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
        <Stat label="Win rate (lower bound)" value={pct(s.wilsonLb)} hint={`${pct(s.winRate, { dp: 0 })} raw · ${s.wins}W ${s.losses}L`} />
        <Stat label="Expectancy" value={r(s.expectancyR)} tone={tone(s.expectancyR)} hint="per signal" />
        <Stat label="Alpha vs BTC" value={pp(s.alphaBtc)} tone={tone(s.alphaBtc)} hint="mean, per signal" />
        <Stat label="Max drawdown" value={r(-Math.abs(s.maxDd))} tone="loss" hint="peak to trough" />
        <Stat label="Settled signals" value={s.n} hint={s.voids ? `${s.voids} void` : "VOID excluded"} />
        <Stat label="Follower PnL" value={pp(s.followerPnl)} tone={tone(s.followerPnl)} hint="after fees" />
      </dl>
    </div>
  );
}
