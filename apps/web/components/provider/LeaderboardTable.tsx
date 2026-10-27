import { ArrowDown } from "lucide-react";
import Link from "next/link";
import type { ApiProvider } from "@nundina/shared";
import { Badge, providerBadges } from "@/components/brand/Badge";
import { cn } from "@/lib/cn";
import { pct, pp, r, usd } from "@/lib/format";
import { filterQuery, type Filters } from "@/lib/leaderboard";
import { Avatar } from "./Avatar";

type Col = { key: Filters["sort"] | null; label: string; className?: string };
const COLS: Col[] = [
  { key: "score", label: "Score" },
  { key: "wilson", label: "Win rate LB" },
  { key: "expectancy", label: "Expectancy" },
  { key: "alpha", label: "Alpha vs BTC" },
  { key: "n", label: "Settled" },
  { key: "pnl", label: "Follower PnL" },
  { key: null, label: "Price" },
  { key: null, label: "Bond" },
];

/**
 * Ranked providers, then a separated probation group (no rank). A table from 640 px, cards below.
 * Column headers are sort links.
 */
export function LeaderboardTable({ providers, filters }: { providers: ApiProvider[]; filters: Filters }) {
  const ranked = providers.filter((p) => !p.score.probation);
  const probation = providers.filter((p) => p.score.probation);
  return (
    <div>
      {/* ≥ 640 px */}
      <div className="hidden overflow-x-auto rounded-2xl border border-border bg-surface sm:block">
        <table className="w-full min-w-[920px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th scope="col" className="w-12 py-3 pl-5 font-medium">
                #
              </th>
              <th scope="col" className="py-3 font-medium">
                Provider
              </th>
              {COLS.map((c) => (
                <th key={c.label} scope="col" className="py-3 pr-5 text-right font-medium" aria-sort={c.key && c.key === filters.sort ? "descending" : undefined}>
                  {c.key ? (
                    <Link
                      href={`/leaderboard${filterQuery({ ...filters, sort: c.key })}`}
                      scroll={false}
                      className={cn("inline-flex items-center gap-1 hover:text-text", c.key === filters.sort && "text-text")}
                    >
                      {c.label}
                      {c.key === filters.sort ? <ArrowDown aria-hidden className="size-3" /> : null}
                    </Link>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ranked.map((p, i) => (
              <Row key={p.handle} p={p} rank={i + 1} i={i} />
            ))}
            {probation.length ? (
              <tr>
                <th colSpan={COLS.length + 2} scope="rowgroup" className="border-y border-border bg-surface-2/60 px-5 py-2 text-left text-xs font-medium text-muted">
                  On probation · fewer than 30 settled signals, not ranked
                </th>
              </tr>
            ) : null}
            {probation.map((p, j) => (
              <Row key={p.handle} p={p} i={ranked.length + j} />
            ))}
          </tbody>
        </table>
      </div>

      {/* < 640 px */}
      <div className="flex flex-col gap-2 sm:hidden">
        {ranked.map((p, i) => (
          <MobileCard key={p.handle} p={p} rank={i + 1} />
        ))}
        {probation.length ? <p className="mt-4 px-1 text-xs font-medium text-muted">On probation · not ranked</p> : null}
        {probation.map((p) => (
          <MobileCard key={p.handle} p={p} />
        ))}
      </div>
    </div>
  );
}

function providerHref(p: ApiProvider) {
  return p.observed ? null : `/p/${p.handle}`;
}

function Name({ p }: { p: ApiProvider }) {
  const href = providerHref(p);
  const inner = (
    <>
      <span className="truncate font-medium">{p.displayName}</span>
      <span className="truncate text-xs text-muted">{p.observed ? (p.channelTitle ?? p.handle) : `@${p.handle}`}</span>
    </>
  );
  return href ? (
    <Link href={href} className="flex min-w-0 flex-col hover:text-accent">
      {inner}
    </Link>
  ) : (
    <span className="flex min-w-0 flex-col">{inner}</span>
  );
}

function Row({ p, rank, i = 0 }: { p: ApiProvider; rank?: number; i?: number }) {
  const s = p.score;
  return (
    <tr
      data-testid="leaderboard-row"
      style={{ animationDelay: `${Math.min(i, 12) * 45}ms` }}
      className={cn("rise border-b border-border/60 transition-colors last:border-0 hover:bg-surface-2/50", !rank && "text-muted")}
    >
      <td className="num py-3 pl-5 text-muted">{rank ?? "—"}</td>
      <td className="py-3">
        <div className="flex items-center gap-3">
          <Avatar handle={p.handle} name={p.displayName} className="size-8" />
          <Name p={p} />
          <div className="flex gap-1">
            {providerBadges(p)
              .filter((b) => b !== "probation")
              .map((b) => (
                <Badge key={b} kind={b} compact />
              ))}
          </div>
        </div>
      </td>
      <td className="num py-3 pr-5 text-right text-base font-medium text-text">{s.score == null ? "—" : s.score.toFixed(0)}</td>
      <td className="num py-3 pr-5 text-right">{pct(s.wilsonLb)}</td>
      <td className={cn("num py-3 pr-5 text-right", s.expectancyR >= 0 ? "text-win" : "text-loss")}>{r(s.expectancyR)}</td>
      <td className={cn("num py-3 pr-5 text-right", s.alphaBtc >= 0 ? "text-win" : "text-loss")}>{pp(s.alphaBtc)}</td>
      <td className="num py-3 pr-5 text-right">{s.n}</td>
      <td className={cn("num py-3 pr-5 text-right", s.followerPnl > 0 ? "text-win" : s.followerPnl < 0 ? "text-loss" : "text-muted")}>{pp(s.followerPnl)}</td>
      <td className="num py-3 pr-5 text-right">{p.observed ? "—" : usd(p.defaultPriceUsd)}</td>
      <td className="num py-3 pr-5 text-right">{p.observed ? "—" : usd(p.bondUsd, { compact: true })}</td>
    </tr>
  );
}

function MobileCard({ p, rank }: { p: ApiProvider; rank?: number }) {
  const s = p.score;
  return (
    <div data-testid="leaderboard-row" className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center gap-3">
        <span className="num w-6 text-sm text-muted">{rank ?? "—"}</span>
        <Avatar handle={p.handle} name={p.displayName} className="size-8" />
        <Name p={p} />
        <span className="num ml-auto text-xl font-medium">{s.score == null ? "—" : s.score.toFixed(0)}</span>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-muted">Win LB</dt>
          <dd className="num mt-0.5 text-sm">{pct(s.wilsonLb)}</dd>
        </div>
        <div>
          <dt className="text-muted">Expectancy</dt>
          <dd className={cn("num mt-0.5 text-sm", s.expectancyR >= 0 ? "text-win" : "text-loss")}>{r(s.expectancyR)}</dd>
        </div>
        <div>
          <dt className="text-muted">Settled</dt>
          <dd className="num mt-0.5 text-sm">{s.n}</dd>
        </div>
      </dl>
    </div>
  );
}
