"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Loader2, Pause, Play } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { erc20Abi, formatUnits, getAddress, parseUnits } from "viem";
import { useBalance, useConfig, useReadContract } from "wagmi";
import { waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { AgentPolicyForm, DEFAULT_POLICY } from "@/components/flows/AgentPolicyForm";
import { WalletGate } from "@/components/flows/WalletGate";
import { DashSkeleton, rowIn } from "@/components/dashboard/Stats";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "@/components/ui/external";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { TOKENS } from "@/lib/contracts";
import { ago, explorer, short, usd } from "@/lib/format";
import { agentsApi, type AgentView } from "@/lib/session";
import { walletErrorMessage } from "@/lib/wallet/useWallet";

export function AgentsDashboard() {
  return (
    <WalletGate title="Connect to manage your agent" needKey={false}>
      <Inner />
    </WalletGate>
  );
}

function Inner() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["agents"], queryFn: agentsApi.list });
  const [created, setCreated] = useState<{ apiKey: string; agentId: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (list.isPending) return <DashSkeleton stats={4} />;
  const agents = list.data?.items.filter((a) => a.type === "execution") ?? [];

  return (
    <div className="space-y-8" data-testid="agents-dashboard">
      {created ? (
        <div className="rise rounded-2xl border border-locked/40 bg-locked/[0.06] p-5" role="status">
          <p className="font-medium">Agent API key (shown once)</p>
          <p className="mt-1 text-sm text-muted">Store it somewhere safe. It lets the agent act within its policy; you can pause it here at any time.</p>
          <button
            type="button"
            onClick={() => void navigator.clipboard?.writeText(created.apiKey)}
            className="num mt-3 flex w-full items-center justify-between gap-2 break-all rounded-xl border border-border bg-surface px-3 py-2 text-left text-sm"
            data-testid="api-key"
          >
            {created.apiKey} <Copy aria-hidden className="size-4 shrink-0" />
          </button>
        </div>
      ) : null}

      {agents.length ? (
        agents.map((a) => <AgentCard key={a.id} a={a} />)
      ) : (
        <section className="rise rounded-2xl border border-border p-5">
          <h2 className="font-medium">Create an execution agent</h2>
          <p className="mt-1 text-sm text-muted">It gets its own wallet. Fund it, set limits, and it buys live signals that pass your policy, logging why for every buy or skip.</p>
          <div className="mt-4">
            <AgentPolicyForm
              initial={DEFAULT_POLICY}
              submitLabel="Create agent"
              onSubmit={async (p) => {
                setError(null);
                try {
                  const r = await agentsApi.create("Execution agent", p);
                  setCreated({ apiKey: r.apiKey, agentId: r.agent.id });
                  await qc.invalidateQueries({ queryKey: ["agents"] });
                } catch (e) {
                  setError(e instanceof ApiError ? e.message : String(e));
                }
              }}
            />
          </div>
          {error ? <p role="alert" className="mt-2 text-sm text-loss">{error}</p> : null}
        </section>
      )}
    </div>
  );
}

function AgentCard({ a }: { a: AgentView }) {
  const qc = useQueryClient();
  const wagmi = useConfig();
  const wallet = a.wallet ? getAddress(a.wallet) : undefined;
  const usdt = useReadContract({
    address: TOKENS.USDT.address(),
    abi: erc20Abi,
    functionName: "balanceOf",
    args: wallet ? [wallet] : undefined,
    query: { enabled: Boolean(wallet), refetchInterval: 15_000 },
  });
  const gas = useBalance({ address: wallet, query: { enabled: Boolean(wallet), refetchInterval: 15_000 } });
  const activity = useQuery({ queryKey: ["agent-activity", a.id], queryFn: () => agentsApi.activity(a.id), refetchInterval: 15_000 });
  const [fund, setFund] = useState("5");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const budget = Number(a.policy.dailyBudgetUsd);
  const spentPct = budget > 0 ? Math.min(100, (Number(a.spentTodayUsd) / budget) * 100) : 0;

  async function act(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setMsg(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ["agents"] });
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : walletErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const sendFunds = () =>
    act("fund", async () => {
      const h = await writeContract(wagmi, { address: TOKENS.USDT.address(), abi: erc20Abi, functionName: "transfer", args: [wallet!, parseUnits(fund, 6)] });
      await waitForTransactionReceipt(wagmi, { hash: h });
      await usdt.refetch();
    });

  return (
    <section className="rise space-y-5 rounded-2xl border border-border p-5" data-testid="agent-card">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-medium">{a.name}</h2>
        <span className={cn("pill-in inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs", a.paused ? "bg-locked/15 text-locked" : "bg-win/15 text-win")} key={String(a.paused)} data-testid="agent-status">
          <span aria-hidden className={cn("size-1.5 rounded-full bg-current", !a.paused && "pulse-ring")} />
          {a.paused ? "Paused" : "Running"}
        </span>
        <Button
          size="sm"
          variant={a.paused ? "accent" : "outline"}
          className="ml-auto"
          onClick={() => void act("pause", () => agentsApi.pause(a.id, !a.paused))}
          disabled={Boolean(busy)}
          data-testid="pause"
        >
          {a.paused ? <Play aria-hidden /> : <Pause aria-hidden />}
          {a.paused ? "Resume" : "Pause"}
        </Button>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted">Agent wallet</dt>
          <dd>
            <ExternalLink href={wallet ? explorer.address(wallet) : null} label="explorer">
              {short(wallet)}
            </ExternalLink>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">USDT balance</dt>
          <dd className="num">{usdt.data == null ? "—" : usd(formatUnits(usdt.data, 6))}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Gas</dt>
          <dd className="num">{gas.data ? `${Number(formatUnits(gas.data.value, 18)).toFixed(4)} HSK` : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Spent today</dt>
          <dd className="num">
            {usd(a.spentTodayUsd)} / {usd(a.policy.dailyBudgetUsd)}
          </dd>
          <dd aria-hidden className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-2">
            <div
              className={cn("h-full rounded-full transition-[width] duration-700 ease-[var(--ease-out)]", spentPct >= 90 ? "bg-locked" : "bg-accent")}
              style={{ width: `${spentPct}%` }}
            />
          </dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-end gap-2">
        <label className="block w-32">
          <span className="text-xs text-muted">Fund (USDT)</span>
          <input inputMode="decimal" value={fund} onChange={(e) => setFund(e.target.value)} className="input num mt-1" />
        </label>
        <Button variant="outline" onClick={() => void sendFunds()} disabled={Boolean(busy) || !wallet || !/^\d+(\.\d{1,6})?$/.test(fund)}>
          {busy === "fund" ? <Loader2 aria-hidden className="animate-spin" /> : null}
          Send to agent
        </Button>
        <p className="w-full text-xs text-muted">The agent also needs a little HSK for gas. Send it from your wallet to the address above.</p>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Policy</h3>
          <Button size="sm" variant="ghost" onClick={() => setEditing((v) => !v)}>
            {editing ? "Close" : "Edit"}
          </Button>
        </div>
        {editing ? (
          <div className="mt-3">
            <AgentPolicyForm
              initial={a.policy}
              submitLabel="Save policy"
              onSubmit={(p) => act("policy", async () => (await agentsApi.policy(a.id, p), setEditing(false)))}
            />
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted">
            Up to {usd(a.policy.maxPerSignalUsd)} per signal, {usd(a.policy.dailyBudgetUsd)} a day, score ≥ {a.policy.minScore ?? 0}, {a.policy.markets.join(", ") || "any market"}
            {a.policy.providersAllow.length ? `, only ${a.policy.providersAllow.map((h) => `@${h}`).join(" ")}` : ""}
            {a.policy.autoTrade ? `, auto-trade (≤ ${a.policy.slippageBps} bps slippage)` : ""}.
          </p>
        )}
      </div>

      <div>
        <h3 className="font-medium">Activity</h3>
        <ul className="mt-2 divide-y divide-border rounded-xl border border-border text-sm" data-testid="agent-activity">
          {activity.data?.items.length ? (
            activity.data.items.map((x, i) => (
              <li key={x.id} style={rowIn(i)} className="pill-in flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2">
                <span className={cn("w-12 font-medium uppercase", x.decision === "buy" ? "text-win" : x.decision === "error" ? "text-loss" : "text-muted")}>{x.decision}</span>
                {x.signalId ? (
                  <Link href={`/s/${x.signalId}`} className="hover:text-accent">
                    #{x.signalId}
                  </Link>
                ) : null}
                <span className="min-w-0 flex-1 text-muted">{x.reason}</span>
                <span className="text-xs text-muted">{ago(x.createdAt)}</span>
              </li>
            ))
          ) : (
            <li className="px-3 py-4 text-center text-muted">No activity yet. The agent checks live signals every minute.</li>
          )}
        </ul>
      </div>
      {msg ? <p role="alert" className="text-sm text-loss">{msg}</p> : null}
    </section>
  );
}
