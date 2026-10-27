"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Lock, ShieldCheck, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { erc20Abi, formatUnits, getAddress, type Address } from "viem";
import { useConfig, useReadContract, useReadContracts } from "wagmi";
import { readContract } from "wagmi/actions";
import { providerRegistryAbi } from "@nundina/shared/abis";
import type { ApiProviderDetail, ApiSignalDetail } from "@nundina/shared";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "@/components/ui/external";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { addr, fastPathEnabled, TOKENS, type TokenKey } from "@/lib/contracts";
import { ago, explorer, price, short, usd } from "@/lib/format";
import { payIntent, signFastPath } from "@/lib/hsp/pay";
import { purchasesApi, type PurchaseView } from "@/lib/session";
import { decryptPurchase, KEYED_STATUSES, useMyPurchase, type UnlockedSignal } from "@/lib/unlock";
import { useWallet, walletErrorMessage } from "@/lib/wallet/useWallet";
import { WalletGate } from "./WalletGate";

type Stage = "idle" | "signing" | "checkout" | "transfer" | "verifying" | "credited" | "unlocking" | "done" | "error";
const STAGES: { key: Stage; label: string }[] = [
  { key: "transfer", label: "Paid" },
  { key: "verifying", label: "Verified by HSP" },
  { key: "credited", label: "Credited to escrow" },
  { key: "done", label: "Unlocked" },
];
const STAGE_RANK: Record<Stage, number> = { idle: -1, signing: -1, checkout: -1, transfer: 0, verifying: 1, credited: 2, unlocking: 2, done: 3, error: -1 };

/** Human copy for API and wallet failures (spec: network, balance, rejected, capacity, HSP POLICY). */
function buyError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === "capacity_full") return "This provider's bond can't cover another buyer right now. Try again after some of their signals settle.";
    if (e.code === "already_bought") return "You already bought this signal.";
    if (e.code === "signal_closed" || e.code === "signal_expired") return "This signal is no longer open.";
    return e.message;
  }
  return walletErrorMessage(e);
}

export function BuyFlow({ signal, provider, onDone }: { signal: ApiSignalDetail; provider: ApiProviderDetail | null; onDone?: (s: UnlockedSignal) => void }) {
  return (
    <WalletGate title="Connect to buy">
      <BuyInner signal={signal} provider={provider} onDone={onDone} />
    </WalletGate>
  );
}

function BuyInner({ signal, provider, onDone }: { signal: ApiSignalDetail; provider: ApiProviderDetail | null; onDone?: (s: UnlockedSignal) => void }) {
  const w = useWallet();
  const wagmi = useConfig();
  const qc = useQueryClient();
  const { purchase: existing } = useMyPurchase(signal.id);
  const [token, setToken] = useState<TokenKey>("USDT");
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [purchaseId, setPurchaseId] = useState<string | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState<UnlockedSignal | null>(null);

  const price6 = BigInt(Math.round(Number(signal.priceUsd) * 1e6));
  const registry = addr("ProviderRegistry");
  const escrow = addr("PerformanceEscrow");
  const reads = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: TOKENS.USDT.address(), abi: erc20Abi, functionName: "balanceOf", args: [w.address!] },
      { address: TOKENS.USDC_E.address(), abi: erc20Abi, functionName: "balanceOf", args: [w.address!] },
    ],
    query: { enabled: Boolean(w.address), refetchInterval: 15_000 },
  });
  const cap = useReadContract({
    address: registry ?? undefined,
    abi: providerRegistryAbi,
    functionName: "capacity",
    args: provider ? [getAddress(provider.address), price6] : undefined,
    query: { enabled: Boolean(registry && provider), refetchInterval: 15_000 },
  });
  const bal = (i: number) => (reads.data?.[i]?.status === "success" ? (reads.data[i]!.result as bigint) : null);
  const balances: Record<TokenKey, bigint | null> = { USDT: bal(0), USDC_E: bal(1) };
  const capacity = cap.data ?? null;
  const enough = balances[token] == null || balances[token]! >= price6;

  // Poll the purchase until the key is delivered (or it is rejected). Gateway checkouts poll through
  // /sync, which also asks HSP whether the buyer has paid yet.
  const poll = useQuery({
    queryKey: ["purchase", purchaseId, Boolean(checkoutUrl)],
    queryFn: () => (checkoutUrl ? purchasesApi.sync(purchaseId!) : purchasesApi.get(purchaseId!)),
    enabled: Boolean(purchaseId) && stage !== "done" && stage !== "error",
    refetchInterval: checkoutUrl ? 3000 : 1500,
  });
  useEffect(() => {
    const p = poll.data;
    if (!p) return;
    if (p.status === "REJECTED") {
      setStage("error");
      setError(p.rejectReason?.startsWith("POLICY") ? `HSP blocked this payment: ${p.rejectReason}` : `Payment rejected: ${p.rejectReason ?? "unknown reason"}. Funds that reached escrow are returned to you.`);
      return;
    }
    if (p.status === "SUBMITTED" || p.status === "FAILED_RETRYABLE") setStage("verifying");
    if (p.status === "CREDITED") setStage("credited");
    if (KEYED_STATUSES.includes(p.status) && stage !== "unlocking") void unlock(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poll.data]);

  // Bought earlier (another device or tab): go straight to unlocking.
  useEffect(() => {
    if (existing && KEYED_STATUSES.includes(existing.status) && stage === "idle") void unlock(existing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.id, existing?.status]);

  async function unlock(p: PurchaseView) {
    if (!w.encKey) return;
    setStage("unlocking");
    try {
      const s = await decryptPurchase(p.id, w.encKey.privateKey);
      setUnlocked(s);
      setStage("done");
      onDone?.(s);
      void qc.invalidateQueries({ queryKey: ["subscriber"] });
    } catch (e) {
      setStage("error");
      setError(`Could not decrypt: ${buyError(e)}`);
    }
  }

  async function buy() {
    setError(null);
    try {
      setStage("signing");
      const { purchaseId: id, intent } = await purchasesApi.create(signal.id, token);
      setPurchaseId(id);
      if (intent.checkout) {
        // HashKey Merchant gateway: the buyer authorises the transfer to escrow on HSP's checkout page
        setCheckoutUrl(intent.checkout.paymentUrl);
        setStage("checkout");
        window.open(intent.checkout.paymentUrl, "_blank", "noopener");
        return;
      }
      if (token === "USDC_E" && fastPathEnabled && escrow) {
        const auth = await signFastPath(wagmi, {
          token: TOKENS.USDC_E.address(),
          tokenName: await readContract(wagmi, { address: TOKENS.USDC_E.address(), abi: erc20Abi, functionName: "name" }),
          tokenVersion: "2",
          chainId: w.chainId!,
          from: w.address as Address,
          escrow,
          value: price6,
          signalId: BigInt(signal.id),
        });
        setStage("transfer");
        const p = await purchasesApi.authorize(id, auth.authorization, auth.signature);
        if (KEYED_STATUSES.includes(p.status)) await unlock(p);
        return;
      }
      const { mandateSig, txHash } = await payIntent(wagmi, intent);
      setStage("transfer");
      await purchasesApi.submit(id, mandateSig, txHash);
      setStage("verifying");
    } catch (e) {
      setStage("error");
      setError(buyError(e));
    }
  }

  if (unlocked) return <UnlockedCard s={unlocked} purchase={poll.data ?? existing ?? null} />;

  const paying = stage !== "idle" && stage !== "error";
  const p = poll.data;
  return (
    <div className="space-y-4" data-testid="buy-flow">
      <div className="rounded-2xl border border-locked/30 bg-locked/[0.06] p-5">
        <div className="flex items-baseline justify-between">
          <div>
            <p className="text-sm text-muted">@{signal.provider?.handle}</p>
            <p className="text-xs text-muted">
              Score <span className="num text-text">{provider?.score.score ?? "—"}</span> · {provider?.score.n ?? 0} settled
            </p>
          </div>
          <p className="num text-3xl font-medium">{usd(signal.priceUsd)}</p>
        </div>
        <ul className="mt-4 space-y-2 text-sm">
          <li className="flex gap-2">
            <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-win" />
            <span>
              <strong className="font-medium">Refund if wrong.</strong>{" "}
              <span className="text-muted">Your payment waits in escrow. If the call is wrong you get it back plus a slice of the provider&apos;s bond.</span>
            </span>
          </li>
          <li className="flex justify-between text-muted">
            <span>{signal.market} · expires</span>
            <span className="num">{ago(signal.validUntil)}</span>
          </li>
          <li className="flex justify-between text-muted">
            <span>Buyers the bond still covers</span>
            <span className="num" data-testid="capacity">
              {capacity == null ? "—" : capacity.toString()}
            </span>
          </li>
        </ul>
      </div>

      <fieldset disabled={paying}>
        <legend className="mb-2 text-sm text-muted">Pay with</legend>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(TOKENS) as TokenKey[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setToken(k)}
              aria-pressed={token === k}
              className={cn("rounded-xl border p-3 text-left transition-colors", token === k ? "border-accent bg-accent/10" : "border-border hover:bg-surface-2")}
            >
              <span className="flex items-center gap-1.5 font-medium">
                {TOKENS[k].symbol}
                {k === "USDC_E" && fastPathEnabled ? <Zap aria-label="gasless" className="size-3.5 text-accent" /> : null}
              </span>
              <span className="num block text-xs text-muted">Balance {balances[k] == null ? "—" : Number(formatUnits(balances[k]!, 6)).toFixed(2)}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {paying ? (
        <ol className="space-y-2 rounded-2xl border border-border p-4 text-sm" aria-live="polite" data-testid="buy-progress">
          {STAGES.map((s) => {
            const done = STAGE_RANK[stage] >= STAGE_RANK[s.key];
            const active = STAGE_RANK[stage] + 1 === STAGE_RANK[s.key];
            return (
              <li key={s.key} className={cn("flex items-center gap-2", !done && !active && "text-muted")}>
                {done ? <Check aria-hidden className="size-4 text-win" /> : active ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <span className="size-4" />}
                <span>{s.label}</span>
                {s.key === "verifying" && p?.paymentId ? (
                  <ExternalLink href={explorer.hsp(p.paymentId)} className="ml-auto text-xs text-muted" label="HSP payment">
                    {short(p.paymentId)}
                  </ExternalLink>
                ) : null}
                {s.key === "credited" && p?.creditedTx ? (
                  <ExternalLink href={explorer.tx(p.creditedTx)} className="ml-auto text-xs text-muted" label="credit transaction">
                    {short(p.creditedTx)}
                  </ExternalLink>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}

      {stage === "checkout" && checkoutUrl ? (
        <p className="text-sm text-muted" data-testid="hsp-checkout">
          Finish paying in the HSP checkout.{" "}
          <ExternalLink href={checkoutUrl} label="HSP checkout">
            Open checkout
          </ExternalLink>
        </p>
      ) : null}

      {!enough ? (
        <p role="alert" className="text-sm text-loss">
          Not enough {TOKENS[token].symbol}: you need {usd(signal.priceUsd)}.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-loss" data-testid="buy-error">
          {error}
        </p>
      ) : null}

      <Button size="lg" variant="accent" className="w-full" onClick={() => void buy()} disabled={paying || !enough || capacity === 0n} data-testid="pay">
        {paying ? <Loader2 aria-hidden className="animate-spin" /> : <Lock aria-hidden />}
        {stage === "signing" ? "Confirm in wallet…" : stage === "checkout" ? "Waiting for HSP checkout…" : paying ? "Processing…" : `Pay ${usd(signal.priceUsd)} ${TOKENS[token].symbol}`}
      </Button>
      <p className="text-center text-xs text-muted">Paid through HSP · the key is decrypted on this device only</p>
    </div>
  );
}

export function UnlockedCard({ s, purchase }: { s: UnlockedSignal; purchase: PurchaseView | null }) {
  return (
    <div className="rounded-2xl border border-win/30 bg-win/[0.06] p-5" data-testid="unlocked">
      <p className="flex items-center gap-2 text-sm text-win">
        <Check aria-hidden className="size-4" /> Unlocked on this device
      </p>
      <p className={cn("mt-3 text-3xl font-semibold", s.side === "LONG" ? "text-win" : "text-loss")}>
        {s.side} <span className="text-text">{s.market}</span>
      </p>
      <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
        {(
          [
            ["Entry", s.entry, ""],
            ["Take profit", s.takeProfit, "text-win"],
            ["Stop loss", s.stopLoss, "text-loss"],
          ] as const
        ).map(([k, v, t]) => (
          <div key={k}>
            <dt className="text-xs text-muted">{k}</dt>
            <dd className={cn("num mt-0.5 text-lg font-medium", t)}>{price(v, s.market)}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-muted">
        Valid {ago(s.validUntil)}
        {purchase?.paymentId ? (
          <>
            {" "}· HSP{" "}
            <ExternalLink href={explorer.hsp(purchase.paymentId)} label="HSP payment">
              {short(purchase.paymentId)}
            </ExternalLink>
          </>
        ) : null}
      </p>
    </div>
  );
}
