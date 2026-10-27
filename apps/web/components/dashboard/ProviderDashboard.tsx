"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { ApiSignal } from "@nundina/shared";
import { providerRegistryAbi } from "@nundina/shared/abis";
import { useConfig } from "wagmi";
import { waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { BondManager } from "@/components/flows/BondManager";
import { ProviderOnboarding } from "@/components/flows/ProviderOnboarding";
import { WalletGate } from "@/components/flows/WalletGate";
import { CopyBadge } from "@/components/provider/CopyBadge";
import { SignalStatusPill } from "@/components/signal/SignalStatusPill";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "@/components/ui/external";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { config } from "@/lib/config";
import { addr } from "@/lib/contracts";
import { ago, explorer, r as fmtR, short, usd } from "@/lib/format";
import { me, providerApi, type MyProvider } from "@/lib/session";
import { signalState } from "@/lib/signal-state";
import { useWallet, walletErrorMessage } from "@/lib/wallet/useWallet";

type Tab = "live" | "reveal" | "settled";
const tabOf = (s: ApiSignal): Tab =>
  s.outcome ? "settled" : !s.revealed && Date.parse(s.validUntil) <= Date.now() ? "reveal" : "live";

export function ProviderDashboard() {
  return (
    <WalletGate title="Connect your provider wallet" needKey={false}>
      <Inner />
    </WalletGate>
  );
}

function Inner() {
  const q = useQuery({ queryKey: ["me-provider"], queryFn: me.provider, retry: false, refetchInterval: 30_000 });
  if (q.isPending) return <div className="h-96 animate-pulse rounded-2xl bg-surface" />;
  if (q.error instanceof ApiError && q.error.status === 404) {
    return (
      <div className="space-y-4">
        <p className="text-muted">You don&apos;t have a provider profile yet.</p>
        <ProviderOnboarding />
      </div>
    );
  }
  if (q.error) return <p role="alert" className="text-sm text-loss">{q.error.message}</p>;
  return <Dash d={q.data} />;
}

function Dash({ d }: { d: MyProvider }) {
  const w = useWallet();
  const [tab, setTab] = useState<Tab>("live");
  const groups: Record<Tab, ApiSignal[]> = { live: [], reveal: [], settled: [] };
  for (const s of d.recentSignals) groups[tabOf(s)].push(s);
  const setupDone = d.provider.linked && Number(d.bond.totalUsd) > 0;

  return (
    <div className="space-y-8" data-testid="provider-dashboard">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted">Provider</p>
          <h1 className="text-3xl font-semibold tracking-tight">@{d.provider.handle}</h1>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/p/${d.provider.handle}`}>Public profile</Link>
        </Button>
      </header>

      {!setupDone ? (
        <details className="rounded-2xl border border-locked/30 bg-locked/[0.06] p-4" open>
          <summary className="cursor-pointer font-medium">Finish setup</summary>
          <div className="mt-4">
            <ProviderOnboarding />
          </div>
        </details>
      ) : null}

      <section className="space-y-3">
        <h2 className="font-medium">Bond</h2>
        <BondManager provider={w.address!} defaultPriceUsd={d.settings.defaultPriceUsd} />
      </section>

      <section>
        <div role="tablist" aria-label="Signals" className="flex gap-1 rounded-full border border-border p-1 text-sm">
          {(
            [
              ["live", "Live"],
              ["reveal", "Awaiting reveal"],
              ["settled", "Settled"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={cn("flex-1 rounded-full px-3 py-1.5", tab === k ? "bg-surface-2 text-text" : "text-muted")}
            >
              {label} <span className="num text-xs text-muted">{groups[k].length}</span>
            </button>
          ))}
        </div>
        {tab === "reveal" && groups.reveal.length ? (
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-locked/30 bg-locked/[0.06] px-3 py-2 text-sm">
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-locked" />
            Expired signals are revealed automatically. If a reveal fails before the deadline the signal counts as a loss and buyers are refunded from your bond.
          </p>
        ) : null}
        <ul className="mt-3 divide-y divide-border rounded-2xl border border-border">
          {groups[tab].length ? (
            groups[tab].map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
                <Link href={`/s/${s.id}`} className="font-medium hover:text-accent">
                  {s.market} #{s.id}
                </Link>
                <SignalStatusPill state={signalState(s)} />
                <span className="text-muted">{s.purchaseCount} buyers</span>
                <span className="num ml-auto">{s.outcome ? fmtR(s.rMultiple) : `ends ${ago(s.validUntil)}`}</span>
              </li>
            ))
          ) : (
            <li className="px-4 py-6 text-center text-sm text-muted">Nothing here yet.</li>
          )}
        </ul>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-border p-5">
          <h2 className="font-medium">Earnings</h2>
          <dl className="mt-3 grid grid-cols-4 gap-3">
            {(
              [
                ["Gross", d.earnings.grossUsd],
                ["Fees", d.earnings.feesUsd],
                ["Slashed", d.earnings.slashedUsd],
                ["Net", d.earnings.netUsd],
              ] as const
            ).map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted">{k}</dt>
                <dd className={cn("num mt-1 text-lg font-medium", k === "Slashed" && Number(v) > 0 && "text-loss")}>{usd(v)}</dd>
              </div>
            ))}
          </dl>
          <ul className="mt-4 space-y-1 text-sm">
            {d.payouts.slice(0, 6).map((p) => (
              <li key={p.signalId} className="flex justify-between gap-2">
                <Link href={`/s/${p.signalId}`} className="text-muted hover:text-text">
                  #{p.signalId} {p.outcome}
                </Link>
                <span className="num">
                  {Number(p.slashUsd) > 0 ? <span className="text-loss">−{usd(p.slashUsd)}</span> : usd(p.payoutUsd)}{" "}
                  {p.settleTx ? (
                    <ExternalLink href={explorer.tx(p.settleTx)} className="text-xs text-muted" label="settle transaction">
                      {short(p.settleTx, 4, 3)}
                    </ExternalLink>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <Settings d={d} />
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Badge</h2>
        <CopyBadge handle={d.provider.handle} siteUrl={config.siteUrl} />
      </section>
    </div>
  );
}

function Settings({ d }: { d: MyProvider }) {
  const qc = useQueryClient();
  const wagmi = useConfig();
  const [price, setPrice] = useState(d.settings.defaultPriceUsd);
  const [hours, setHours] = useState(String(d.settings.defaultValidityHours));
  const [payIfWorks, setPayIfWorks] = useState(d.settings.payIfWorks);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setBusy("save");
    setMsg(null);
    try {
      await providerApi.settings({ defaultPrice: price, defaultValidityHours: Number(hours), payIfWorks });
      await qc.invalidateQueries({ queryKey: ["me-provider"] });
      setMsg({ ok: true, text: "Saved" });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function leavePractice() {
    const registry = addr("ProviderRegistry");
    if (!registry) return;
    setBusy("practice");
    setMsg(null);
    try {
      const h = await writeContract(wagmi, { address: registry, abi: providerRegistryAbi, functionName: "leavePractice" });
      await waitForTransactionReceipt(wagmi, { hash: h });
      await providerApi.settings({ practice: false });
      await qc.invalidateQueries({ queryKey: ["me-provider"] });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : walletErrorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-border p-5" data-testid="provider-settings">
      <h2 className="font-medium">Settings</h2>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs text-muted">Default price (USD)</span>
          <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} disabled={d.settings.practice} className="input num mt-1" />
        </label>
        <label className="block">
          <span className="text-xs text-muted">Default validity (hours)</span>
          <input inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} className="input num mt-1" />
        </label>
      </div>
      <label className={cn("flex items-center gap-2 text-sm", !d.settings.payIfWorksAllowed && "text-muted")}>
        <input type="checkbox" checked={payIfWorks} disabled={!d.settings.payIfWorksAllowed} onChange={(e) => setPayIfWorks(e.target.checked)} />
        Pay-if-works pricing {d.settings.payIfWorksAllowed ? null : <span className="text-xs">(unlocks after 30 settled signals)</span>}
      </label>
      <div className="flex flex-wrap gap-2">
        <Button variant="accent" size="sm" onClick={() => void save()} disabled={Boolean(busy)}>
          {busy === "save" ? <Loader2 aria-hidden className="animate-spin" /> : null}
          Save
        </Button>
        {d.settings.practice ? (
          <Button variant="outline" size="sm" onClick={() => void leavePractice()} disabled={Boolean(busy)}>
            {busy === "practice" ? <Loader2 aria-hidden className="animate-spin" /> : null}
            Leave practice and start charging
          </Button>
        ) : null}
      </div>
      {msg ? (
        <p role={msg.ok ? "status" : "alert"} className={cn("text-sm", msg.ok ? "text-win" : "text-loss")}>
          {msg.text}
        </p>
      ) : null}
    </div>
  );
}
