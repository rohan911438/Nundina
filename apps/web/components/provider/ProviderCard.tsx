import Link from "next/link";
import type { ApiProvider } from "@nundina/shared";
import { Badge, providerBadges } from "@/components/brand/Badge";
import { pct, r, usd } from "@/lib/format";
import { Avatar } from "./Avatar";

export function ProviderCard({ p, rank }: { p: ApiProvider; rank?: number }) {
  return (
    <Link
      href={`/p/${p.handle}`}
      className="group flex flex-col rounded-2xl border border-border bg-surface p-5 transition-colors hover:border-accent/40"
    >
      <div className="flex items-center gap-3">
        <Avatar handle={p.handle} name={p.displayName} />
        <div className="min-w-0">
          <p className="truncate font-semibold group-hover:text-accent">{p.displayName}</p>
          <p className="truncate text-sm text-muted">@{p.handle}</p>
        </div>
        {rank ? <span className="num ml-auto text-sm text-muted">#{rank}</span> : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {providerBadges(p).map((b) => (
          <Badge key={b} kind={b} />
        ))}
      </div>
      <dl className="mt-6 grid grid-cols-3 gap-3 border-t border-border pt-4">
        <div>
          <dt className="text-xs text-muted">Score</dt>
          <dd className="num mt-1 text-2xl font-medium">{p.score.score == null ? "—" : p.score.score.toFixed(0)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Win rate LB</dt>
          <dd className="num mt-1 text-lg">{pct(p.score.wilsonLb, { dp: 0 })}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Expectancy</dt>
          <dd className={`num mt-1 text-lg ${p.score.expectancyR >= 0 ? "text-win" : "text-loss"}`}>{r(p.score.expectancyR)}</dd>
        </div>
      </dl>
      <p className="mt-4 text-xs text-muted">
        <span className="num">{p.score.n}</span> settled · <span className="num">{usd(p.defaultPriceUsd)}</span> per signal
      </p>
    </Link>
  );
}
