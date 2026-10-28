import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Badge, providerBadges } from "@/components/brand/Badge";
import { Avatar } from "@/components/provider/Avatar";
import { CopyBadge } from "@/components/provider/CopyBadge";
import { EquityCurve } from "@/components/provider/EquityCurve";
import { FollowerStats } from "@/components/provider/FollowerStats";
import { ScorePanel } from "@/components/provider/ScorePanel";
import { SignalHistory } from "@/components/provider/SignalHistory";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ExternalLink } from "@/components/ui/external";
import { api, isNotFound } from "@/lib/api";
import { config } from "@/lib/config";
import { equityPoints } from "@/lib/equity";
import { explorer, r, short, usd } from "@/lib/format";
import { allTimeScore } from "@/lib/score";

export const revalidate = 30;

type Props = { params: Promise<{ handle: string }> };

const load = cache(async (handle: string) => {
  try {
    return await api.provider(handle);
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const p = await load(handle).catch(() => null);
  if (!p) return { title: "Provider not found" };
  const sc = allTimeScore(p);
  const desc = sc.probation
    ? `${p.displayName} on Nundina: ${sc.n} settled signals so far, every one committed on-chain before the move.`
    : `${p.displayName} on Nundina: score ${sc.score?.toFixed(0)}, ${sc.n} settled signals, expectancy ${r(sc.expectancyR)}.`;
  const image = `/api/og/badge/${encodeURIComponent(handle)}`;
  return {
    title: `${p.displayName} (@${p.handle})`,
    description: desc,
    openGraph: { title: `${p.displayName} on Nundina`, description: desc, images: [{ url: image, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", images: [image] },
  };
}

export default async function ProviderPage({ params }: Props) {
  const { handle } = await params;
  const p = await load(decodeURIComponent(handle));
  if (!p) notFound();
  const [history, contracts] = await Promise.all([
    api.providerSignals(p.handle, { limit: 100 }).catch(() => ({ items: [], nextCursor: null })),
    api.contracts().catch(() => null),
  ]);
  const score = allTimeScore(p);
  const identity = typeof contracts?.addresses.IdentityRegistry === "string" ? contracts.addresses.IdentityRegistry : null;
  const chainId = contracts?.chainId;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-10 pt-10 sm:px-6 sm:pt-14">
      <header className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <Avatar handle={p.handle} name={p.displayName} className="size-14 text-base" />
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{p.displayName}</h1>
            <p className="mt-1 text-muted">
              @{p.handle}
              {p.channel ? (
                <>
                  {" · "}
                  {p.channel.url ? (
                    <a href={p.channel.url} target="_blank" rel="noreferrer noopener" className="text-text hover:text-accent" data-testid="verified-channel">
                      {p.channel.title ?? `@${p.channel.username}`}
                      {p.channel.username ? <span className="text-muted"> (@{p.channel.username})</span> : null}
                    </a>
                  ) : (
                    <span className="text-text">{p.channel.title}</span>
                  )}
                  {p.channel.members != null ? <> · {p.channel.members.toLocaleString()} subscribers</> : null}
                </>
              ) : p.channelTitle && p.observed ? (
                <> · {p.channelTitle}</>
              ) : null}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {providerBadges({ ...p, score }).map((b) => (
                <Badge key={b} kind={b} />
              ))}
            </div>
            {p.lookalikeOf ? (
              <p role="note" className="mt-3 max-w-xl rounded-xl border border-loss/40 bg-loss/[0.06] px-3 py-2 text-sm">
                Heads up: this name resembles{" "}
                <a href={`/p/${p.lookalikeOf}`} className="font-medium text-accent hover:underline">
                  @{p.lookalikeOf}
                </a>
                , an earlier provider. Check the channel link before you buy.
              </p>
            ) : null}
            {p.bio ? <p className="mt-4 max-w-xl text-pretty text-sm text-muted">{p.bio}</p> : null}
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:items-end">
          <CopyBadge handle={p.handle} siteUrl={config.siteUrl} />
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:text-right">
            <dt className="text-muted">Bond</dt>
            <dd className="num">{usd(p.bondUsd)}</dd>
            <dt className="text-muted">Price / signal</dt>
            <dd className="num">{usd(p.defaultPriceUsd)}</dd>
            <dt className="text-muted">ERC-8004</dt>
            <dd>
              {p.erc8004Id ? (
                <ExternalLink href={identity ? explorer.token(identity, p.erc8004Id, chainId) : null} label="ERC-8004 identity on explorer">
                  #{p.erc8004Id}
                </ExternalLink>
              ) : (
                <span className="text-muted">—</span>
              )}
            </dd>
            <dt className="text-muted">Wallet</dt>
            <dd>
              <ExternalLink href={p.address ? explorer.address(p.address, chainId) : null} label="Provider wallet on explorer">
                {short(p.address)}
              </ExternalLink>
            </dd>
          </dl>
        </div>
      </header>

      <Card className="mt-10">
        <CardBody className="p-6 sm:p-8">
          <ScorePanel s={score} />
        </CardBody>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Equity curve · cumulative R</CardTitle>
          </CardHeader>
          <CardBody className="pt-3">
            <EquityCurve points={equityPoints(history.items)} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Real follower results</CardTitle>
          </CardHeader>
          <CardBody>
            <FollowerStats score={score} signals={history.items} />
            <p className="mt-6 text-xs leading-relaxed text-muted">
              Every buyer of a losing or unrevealed signal was refunded from escrow, plus a share of the provider&apos;s slashed bond.
            </p>
          </CardBody>
        </Card>
      </div>

      <section className="mt-12">
        <h2 className="text-xl font-semibold tracking-tight">Signal history</h2>
        <p className="mt-1 text-sm text-muted">Every call, including the losers. Live signals stay locked until they settle or you buy them.</p>
        <div className="mt-5">
          <SignalHistory signals={history.items} />
        </div>
      </section>
    </div>
  );
}
