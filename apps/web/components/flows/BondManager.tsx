"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { erc20Abi, formatUnits, parseUnits, type Address } from "viem";
import { useConfig, useReadContract } from "wagmi";
import { readContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { providerRegistryAbi } from "@nundina/shared/abis";
import { Button } from "@/components/ui/button";
import { addr } from "@/lib/contracts";
import { usd } from "@/lib/format";
import { walletErrorMessage } from "@/lib/wallet/useWallet";

const WITHDRAW_DELAY_S = 7 * 24 * 3600;
const fmt = (v: bigint | undefined) => (v == null ? "—" : usd(formatUnits(v, 6)));

/**
 * Provider bond: deposited, locked in open signals, free, and capacity per signal at the default
 * price. Deposit = approve + depositBond; withdraw = request, then withdraw after the 7-day delay.
 */
export function BondManager({ provider, defaultPriceUsd, onChange }: { provider: Address; defaultPriceUsd: string; onChange?: () => void }) {
  const wagmi = useConfig();
  const registry = addr("ProviderRegistry");
  const [amount, setAmount] = useState("10");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const info = useReadContract({
    address: registry ?? undefined,
    abi: providerRegistryAbi,
    functionName: "getProvider",
    args: [provider],
    query: { enabled: Boolean(registry), refetchInterval: 15_000 },
  });
  const p = info.data;
  const wallet = useReadContract({
    address: p?.bondToken,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [provider],
    query: { enabled: Boolean(p), refetchInterval: 15_000 },
  });
  const free = p ? p.bondTotal - p.bondLocked : undefined;
  const priceUnits = parseUnits(defaultPriceUsd || "0", 6);
  const capacity = free != null && priceUnits > 0n ? free / priceUnits : null;
  const unlockAt = p && p.withdrawRequestedAt > 0n ? Number(p.withdrawRequestedAt) + WITHDRAW_DELAY_S : null;
  const canWithdraw = unlockAt != null && unlockAt * 1000 <= Date.now();

  async function tx(label: string, fn: () => Promise<`0x${string}`>) {
    setBusy(label);
    setError(null);
    try {
      const hash = await fn();
      await waitForTransactionReceipt(wagmi, { hash });
      await Promise.all([info.refetch(), wallet.refetch()]);
      onChange?.();
    } catch (e) {
      setError(walletErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const deposit = () =>
    tx("deposit", async () => {
      if (!registry || !p) throw new Error("Register as a provider first");
      const value = parseUnits(amount, 6);
      // the wallet only reports a failed simulation as "resource not found": say what's missing instead
      const balance = await readContract(wagmi, { address: p.bondToken, abi: erc20Abi, functionName: "balanceOf", args: [provider] });
      if (balance < value)
        throw new Error(`Your wallet has ${fmt(balance)} of the bond token (test USDT); this deposit needs ${fmt(value)}. HSK only pays gas.`);
      const allowance = await readContract(wagmi, { address: p.bondToken, abi: erc20Abi, functionName: "allowance", args: [provider, registry] });
      if (allowance < value) {
        // exact amount, never unlimited: wallets flag unlimited approvals as drainer behaviour
        const h = await writeContract(wagmi, { address: p.bondToken, abi: erc20Abi, functionName: "approve", args: [registry, value] });
        await waitForTransactionReceipt(wagmi, { hash: h });
      }
      return writeContract(wagmi, { address: registry, abi: providerRegistryAbi, functionName: "depositBond", args: [value] });
    });
  const requestWithdraw = () =>
    tx("request", () => writeContract(wagmi, { address: registry!, abi: providerRegistryAbi, functionName: "requestBondWithdraw", args: [parseUnits(amount, 6)] }));
  const withdraw = () => tx("withdraw", () => writeContract(wagmi, { address: registry!, abi: providerRegistryAbi, functionName: "withdrawBond" }));

  if (!registry) return <p className="text-sm text-muted">Contracts are not deployed on this network yet.</p>;
  return (
    <div className="rounded-2xl border border-border bg-surface p-5" data-testid="bond">
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat k="Deposited" v={fmt(p?.bondTotal)} />
        <Stat k="Locked in open signals" v={fmt(p?.bondLocked)} />
        <Stat k="Free" v={fmt(free)} />
        <Stat k={`Buyers per signal at ${usd(defaultPriceUsd)}`} v={capacity == null ? "—" : capacity.toString()} />
      </dl>
      <div className="mt-5 flex flex-wrap items-end gap-2">
        <label className="block min-w-32 flex-1">
          <span className="text-xs text-muted">Amount (USD) · in wallet {fmt(wallet.data)}</span>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="input num mt-1" />
        </label>
        <Button variant="accent" onClick={() => void deposit()} disabled={Boolean(busy) || !/^\d+(\.\d{1,6})?$/.test(amount)} data-testid="deposit">
          {busy === "deposit" ? <Loader2 aria-hidden className="animate-spin" /> : null}
          Deposit
        </Button>
        {p && p.withdrawAmount > 0n ? (
          <Button variant="outline" onClick={() => void withdraw()} disabled={Boolean(busy) || !canWithdraw}>
            {busy === "withdraw" ? <Loader2 aria-hidden className="animate-spin" /> : null}
            {canWithdraw ? `Withdraw ${fmt(p.withdrawAmount)}` : `Withdraw ${fmt(p.withdrawAmount)} ${countdown(unlockAt!)}`}
          </Button>
        ) : (
          <Button variant="outline" onClick={() => void requestWithdraw()} disabled={Boolean(busy) || !free}>
            {busy === "request" ? <Loader2 aria-hidden className="animate-spin" /> : null}
            Request withdraw
          </Button>
        )}
      </div>
      <p className="mt-3 text-xs text-muted">Withdrawals wait 7 days, so a bond can&apos;t be pulled right before a losing call settles. Each buyer locks one price of bond until the signal settles.</p>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-loss">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function countdown(unixS: number) {
  const s = Math.max(0, unixS - Math.floor(Date.now() / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return `in ${d}d ${h}h`;
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{k}</dt>
      <dd className="num mt-1 text-xl font-medium">{v}</dd>
    </div>
  );
}
