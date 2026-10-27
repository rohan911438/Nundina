"use client";

import { useQuery } from "@tanstack/react-query";
import { Bot, Lock } from "lucide-react";
import Link from "next/link";
import { SignalStatusPill } from "@/components/signal/SignalStatusPill";
import { signalState } from "@/lib/signal-state";
import { ExternalLink } from "@/components/ui/external";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { ago, explorer, pct, price, short, usd } from "@/lib/format";
import { me, type SubscriberView } from "@/lib/session";
import { decryptPurchase, KEYED_STATUSES } from "@/lib/unlock";
import { useWallet } from "@/lib/wallet/useWallet";
import { WalletGate } from "@/components/flows/WalletGate";

type Row = SubscriberView["purchases"][number];
const isOpen = (r: Row) => !r.signal.outcome && ["COMMITTED", "LIVE", "TOUCH_PENDING", "REVEALED"].includes(r.signal.status);

export function SubscriberDashboard({ compact = false }: { compact?: boolean }) {
  return (
    <WalletGate title="Connect to see your signals">
      <Inner compact={compact} />
    </WalletGate>
  );
}

function Inner({ compact }: { compact: boolean }) {
  const q = useQuery({ queryKey: ["subscriber"], queryFn: me.subscriber, refetchInterval: 30_000 });
  if (q.isPending) return <div className="h-64 animate-pulse rounded-2xl bg-surface" />;
  if (q.error) return <p role="alert" className="text-sm text-loss">{q.error.message}</p>;
  const d = q.data;
  const active = d.purchases.filter(isOpen);
  const history = d.purchases.filter((r) => !isOpen(r));
  const net = Number(d.totals.spentUsd) - Number(d.totals.refundedUsd);
  const followed = [...new Map(d.purchases.filter((r) => r.signal.provider).map((r) => [r.signal.provider!.handle, r.signal.provider!])).values()];

  return (
    <div className="space-y-8" data-testid="subscriber-dashboard">
      {!compact ? (
        <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl border border-border bg-border">
          {(
            [
              ["Spent", usd(d.totals.spentUsd)],
              ["Refunded", usd(d.totals.refundedUsd)],
              ["Net", usd(net)],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="bg-surface p-4">
              <dt className="text-xs text-muted">{k}</dt>
              <dd className="num mt-1 text-2xl font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <section>
        <h2 className="mb-3 font-medium">Active</h2>
        {active.length ? (
          <ul className="space-y-3">
            {active.map((r) => (
              <ActiveRow key={r.id} r={r} />
            ))}
          </ul>
        ) : (
          <Empty>
            No open signals. Browse the{" "}
            <Link href="/leaderboard" className="text-accent hover:underline">
              leaderboard
            </Link>
            .
          </Empty>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-medium">History</h2>
        {history.length ? (
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {history.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
                <Link href={`/s/${r.signalId}`} className="font-medium hover:text-accent">
                  {r.signal.market} #{r.signalId}
                </Link>
                <SignalStatusPill state={signalState(r.signal)} />
                <span className="text-muted">@{r.signal.provider?.handle}</span>
                <span className="num ml-auto">{usd(r.amountUsd)}</span>
                <span className={cn("num w-28 text-right", r.status === "REFUNDED" ? "text-win" : "text-muted")}>
                  {r.status === "REFUNDED" ? `refunded ${usd(r.amountUsd)}` : r.status === "SETTLED_WIN" ? "paid out" : r.status.toLowerCase()}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Settled purchases show up here with their result and refunds.</Empty>
        )}
      </section>

      {!compact ? (
        <section className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-border p-5">
            <h2 className="font-medium">Providers you follow</h2>
            {followed.length ? (
              <ul className="mt-3 flex flex-wrap gap-2">
                {followed.map((p) => (
                  <li key={p.handle}>
                    <Link href={`/p/${p.handle}`} className="rounded-full border border-border px-3 py-1 text-sm hover:border-accent/50">
                      @{p.handle}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted">Providers you buy from appear here.</p>
            )}
          </div>
          <Link href="/dashboard/agents" className="group rounded-2xl border border-border p-5 hover:border-accent/50">
            <p className="flex items-center gap-2 font-medium">
              <Bot aria-hidden className="size-4 text-accent" /> Execution agent
            </p>
            <p className="mt-2 text-sm text-muted">Let an agent buy signals for you within a daily budget and score threshold.</p>
          </Link>
        </section>
      ) : null}
    </div>
  );
}

function ActiveRow({ r }: { r: Row }) {
  const w = useWallet();
  const keyed = KEYED_STATUSES.includes(r.status);
  const sig = useQuery({
    queryKey: ["unlocked", r.signalId, r.id],
    queryFn: () => decryptPurchase(r.id, w.encKey!.privateKey),
    enabled: keyed && Boolean(w.encKey),
    staleTime: Infinity,
    retry: false,
  });
  const last = useQuery({
    queryKey: ["last-price", r.signal.market],
    queryFn: async () => {
      const now = Date.now();
      const c = await api.prices({ market: r.signal.market, interval: "1m", from: Math.floor((now - 15 * 60_000) / 1000), to: Math.floor(now / 1000) });
      return c.candles.at(-1)?.c ?? null;
    },
    refetchInterval: 30_000,
    enabled: Boolean(sig.data),
  });
  const s = sig.data;
  const pl = s && last.data ? ((Number(last.data) - Number(s.entry)) / Number(s.entry)) * (s.side === "LONG" ? 1 : -1) : null;

  return (
    <li className="rounded-2xl border border-border bg-surface p-4" data-testid="active-purchase">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/s/${r.signalId}`} className="font-medium hover:text-accent">
          {r.signal.market} #{r.signalId}
        </Link>
        <span className="text-sm text-muted">@{r.signal.provider?.handle}</span>
        <span className="ml-auto text-xs text-muted">ends {ago(r.signal.validUntil)}</span>
      </div>
      {s ? (
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
          <Cell k="Side" v={s.side} tone={s.side === "LONG" ? "text-win" : "text-loss"} />
          <Cell k="Entry" v={price(s.entry, s.market)} />
          <Cell k="TP" v={price(s.takeProfit, s.market)} tone="text-win" />
          <Cell k="SL" v={price(s.stopLoss, s.market)} tone="text-loss" />
          <Cell k="Live P/L" v={pl == null ? "—" : pct(pl, { signed: true, dp: 2 })} tone={pl == null ? "" : pl >= 0 ? "text-win" : "text-loss"} />
        </div>
      ) : (
        <p className="mt-3 flex items-center gap-2 text-sm text-locked">
          <Lock aria-hidden className="size-4" />
          {keyed ? (sig.isError ? "Couldn't decrypt on this device" : "Decrypting…") : `Payment ${r.status.toLowerCase()}`}
        </p>
      )}
      {r.paymentId ? (
        <p className="mt-2 text-xs text-muted">
          HSP <ExternalLink href={explorer.hsp(r.paymentId)} label="HSP payment">{short(r.paymentId)}</ExternalLink>
          {r.creditedTx ? (
            <>
              {" "}· credit <ExternalLink href={explorer.tx(r.creditedTx)} label="explorer">{short(r.creditedTx)}</ExternalLink>
            </>
          ) : null}
        </p>
      ) : null}
    </li>
  );
}

function Cell({ k, v, tone = "" }: { k: string; v: string; tone?: string }) {
  return (
    <div>
      <p className="text-xs text-muted">{k}</p>
      <p className={cn("num font-medium", tone)}>{v}</p>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted">{children}</p>;
}
