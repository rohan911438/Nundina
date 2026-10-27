import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import type { ApiSignalDetail } from "@nundina/shared";
import { BuyBox } from "@/components/signal/BuyBox";
import { ProofBox } from "@/components/signal/ProofBox";
import { SignalLevels } from "@/components/signal/SignalLevels";
import { SignalStatusPill } from "@/components/signal/SignalStatusPill";
import { UpstreamTree } from "@/components/signal/UpstreamTree";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { api, isNotFound } from "@/lib/api";
import { cn } from "@/lib/cn";
import { hhmm, r, usd, utc } from "@/lib/format";
import { signalState, type SignalState } from "@/lib/signal-state";

export const revalidate = 15;

type Props = { params: Promise<{ id: string }> };

const load = cache(async (id: string) => {
  if (!/^\d+$/.test(id)) return null;
  try {
    return await api.signal(id);
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const s = await load(id).catch(() => null);
  if (!s) return { title: "Signal not found" };
  const st = signalState(s);
  const title =
    st === "win" || st === "loss"
      ? `${st === "win" ? "✅" : "❌"} ${s.market} ${s.side ?? ""} ${r(s.rMultiple)}`
      : `${s.market} signal #${s.id}`;
  const desc = `Committed on HashKey Chain at ${hhmm(s.committedAt)}, before the move${s.provider ? `, by ${s.provider.displayName}` : ""}.`;
  const image = `/api/og/signal/${s.id}`;
  return {
    title,
    description: desc,
    openGraph: { title, description: desc, images: [{ url: image, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", images: [image] },
  };
}

export default async function SignalPage({ params }: Props) {
  const { id } = await params;
  const s = await load(id);
  if (!s) notFound();
  const contracts = await api.contracts().catch(() => null);
  const st = signalState(s);
  const now = Date.now();
  const live = st === "locked" || st === "live";
  // the escrow refuses purchases after validUntil; the keeper settles shortly after
  const buyable = live && new Date(s.validUntil).getTime() > now;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-10 pt-10 sm:px-6 sm:pt-14" data-state={st}>
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link href="/leaderboard" className="hover:text-text">
          Leaderboard
        </Link>
        {s.provider ? (
          <>
            {" / "}
            <Link href={`/p/${s.provider.handle}`} className="hover:text-text">
              {s.provider.displayName}
            </Link>
          </>
        ) : null}
        {" / "}
        <span className="num">#{s.id}</span>
      </nav>

      <header className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">
            {s.market}{" "}
            {s.side ? <span className={s.side === "LONG" ? "text-win" : "text-loss"}>{s.side}</span> : null}
          </h1>
          <p className="mt-2 text-muted">
            Committed <span className="num text-text">{utc(s.committedAt)}</span>
            {s.oraclePriceAtCommit ? (
              <>
                {" "}
                at <span className="num text-text">{Number(s.oraclePriceAtCommit).toLocaleString("en-US")}</span>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {s.rMultiple != null && !live ? (
            <span className={cn("num text-3xl font-medium", st === "win" ? "text-win" : st === "void" || st === "refunded" ? "text-void" : "text-loss")}>
              {r(s.rMultiple)}
            </span>
          ) : null}
          <SignalStatusPill state={st} size="md" />
        </div>
      </header>

      <StateBanner s={s} st={st} />

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardBody>
              <SignalLevels s={s} now={now} />
            </CardBody>
          </Card>
          {s.upstreamTree.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Upstream signals · payout split on a win</CardTitle>
              </CardHeader>
              <CardBody>
                <UpstreamTree tree={s.upstreamTree} />
              </CardBody>
            </Card>
          ) : null}
        </div>
        <aside className="space-y-4">
          {buyable ? <BuyBox signal={s} /> : live ? <SalesClosed /> : null}
          <Card>
            <CardHeader>
              <CardTitle>Proof</CardTitle>
            </CardHeader>
            <CardBody className="pt-2">
              <ProofBox s={s} chainId={contracts?.chainId} />
            </CardBody>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function StateBanner({ s, st }: { s: ApiSignalDetail; st: SignalState }) {
  const set = s.settlement;
  const copy: Record<SignalState, { tone: string; title: string; body: string }> = {
    locked: {
      tone: "border-locked/30 bg-locked/[0.06]",
      title: "Locked until it settles",
      body: "The levels are encrypted on-chain. Buyers get the key right away; everyone sees them after expiry.",
    },
    live: { tone: "border-accent/30 bg-accent/[0.06]", title: "Live", body: "Revealed and waiting for the oracle to see TP or SL touched." },
    resolving: {
      tone: "border-border bg-surface",
      title: "Resolving",
      body: "The oracle has decided; the result is open to challenges for 10 minutes before settlement.",
    },
    win: {
      tone: "border-win/30 bg-win/[0.06]",
      title: "Right call · provider paid",
      body: `Take profit was touched${s.decidedAt ? ` at ${utc(s.decidedAt)}` : ""}. ${set && Number(set.payoutUsd) > 0 ? `${usd(set.payoutUsd)} went to the provider after fees.` : "Nobody bought it, so there was nothing to pay out."}`,
    },
    loss: {
      tone: "border-loss/30 bg-loss/[0.06]",
      title: "Wrong call · buyers refunded",
      body:
        set && Number(set.refundsUsd) > 0
          ? `${usd(set.refundsUsd)} came back to buyers from escrow, plus ${usd(set.slashUsd)} from the provider's bond.`
          : "Nobody had bought it, so there was nothing to refund. It still counts as a loss on the track record.",
    },
    unrevealed: {
      tone: "border-loss/30 bg-loss/[0.06]",
      title: "Never revealed · automatic loss",
      body: "The provider didn't reveal this signal within 6 hours of expiry, so it counts as a loss and every buyer was refunded.",
    },
    void: { tone: "border-border bg-surface", title: "Void", body: "The entry was never reached, so the signal doesn't count either way and buyers were refunded." },
    refunded: {
      tone: "border-border bg-surface",
      title: "Refunded",
      body: "No oracle price was available to decide this signal, so after 24 hours everyone was refunded in full.",
    },
  };
  const c = copy[st];
  return (
    <div className={cn("mt-6 rounded-2xl border p-4 sm:p-5", c.tone)} data-testid="state-banner">
      <p className="font-medium">{c.title}</p>
      <p className="mt-1 text-sm text-muted">{c.body}</p>
    </div>
  );
}

function SalesClosed() {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5" data-testid="sales-closed">
      <p className="flex items-center gap-2 font-medium">
        <span aria-hidden className="pulse-ring size-2 rounded-full bg-locked text-locked" />
        Sales closed
      </p>
      <p className="mt-2 text-sm text-muted">This signal has expired. The oracle is checking the result; buyers are paid out or refunded automatically.</p>
    </div>
  );
}
