"use client";

import { Check, Loader2, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { STEP_LABEL, useWallet, type WalletStep } from "@/lib/wallet/useWallet";

const ORDER: Exclude<WalletStep, "ready">[] = ["disconnected", "wrong_network", "signed_out", "no_key"];

/**
 * Renders children once the wallet is connected, on the right network, signed in and (if
 * `needKey`) holding a decryption key. Until then shows the one next step as a single button.
 */
export function WalletGate({ children, needKey = true, title = "Connect to continue" }: { children: ReactNode; needKey?: boolean; title?: string }) {
  const w = useWallet();
  const step = !needKey && w.step === "no_key" ? "ready" : w.step;
  if (step === "ready") return <>{children}</>;
  const steps = needKey ? ORDER : ORDER.slice(0, 3);
  const current = steps.indexOf(step);
  return (
    <div className="rounded-2xl border border-border bg-surface p-5" data-testid="wallet-gate">
      <p className="font-medium">{title}</p>
      <ol className="mt-4 space-y-2 text-sm">
        {steps.map((s, i) => (
          <li key={s} className={cn("flex items-center gap-2", i > current ? "text-muted" : "")}>
            <span
              className={cn(
                "grid size-5 place-items-center rounded-full border text-[11px]",
                i < current ? "border-win bg-win text-bg" : i === current ? "border-accent text-accent" : "border-border",
              )}
            >
              {i < current ? <Check aria-hidden className="size-3" /> : i + 1}
            </span>
            {STEP_LABEL[s]}
          </li>
        ))}
      </ol>
      {step === "no_key" ? (
        <p className="mt-3 text-xs text-muted">One signature creates a private key that only this device uses to unlock signals you buy. Sign again any time to get the same key back.</p>
      ) : null}
      <Button size="lg" variant="accent" className="mt-5 w-full" onClick={() => void w.advance()} disabled={Boolean(w.busy)} data-testid="wallet-next">
        {w.busy ? <Loader2 aria-hidden className="animate-spin" /> : <Wallet aria-hidden />}
        {STEP_LABEL[step as Exclude<WalletStep, "ready">]}
      </Button>
      {w.error ? (
        <p role="alert" className="mt-3 text-sm text-loss">
          {w.error}
        </p>
      ) : null}
    </div>
  );
}
