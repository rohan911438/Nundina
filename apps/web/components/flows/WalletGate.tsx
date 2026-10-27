"use client";

import { Check, Loader2, Wallet } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { STEP_LABEL, useWallet, type WalletStep } from "@/lib/wallet/useWallet";

const ORDER: Exclude<WalletStep, "ready">[] = ["disconnected", "wrong_network", "signed_out", "no_key"];

/**
 * Renders children once the wallet is connected, on the right network, signed in and (if
 * `needKey`) holding a decryption key. One click walks every missing step in turn: each wallet
 * prompt still needs approval, and a rejection or error stops on that step with the reason.
 */
export function WalletGate({ children, needKey = true, title = "Connect to continue" }: { children: ReactNode; needKey?: boolean; title?: string }) {
  const w = useWallet();
  const step = !needKey && w.step === "no_key" ? "ready" : w.step;
  const [auto, setAuto] = useState(false);
  const inflight = useRef(false);
  // the step the last advance started from: auto-continue waits until the wallet state moves on
  const from = useRef<string | null>(null);

  const go = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    from.current = step;
    try {
      await w.advance();
    } finally {
      inflight.current = false;
    }
  }, [w, step]);

  // keep going after each completed step; stop on an error or once the gate opens
  useEffect(() => {
    if (!auto) return;
    if (step === "ready" || w.error) return setAuto(false);
    if (!w.busy && step !== from.current) void go();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, step, w.busy, w.error]);

  if (step === "ready") return <div className="page-in">{children}</div>;
  const steps = needKey ? ORDER : ORDER.slice(0, 3);
  const current = steps.indexOf(step);
  const progress = Math.max(0, current) / steps.length;

  return (
    <div className="rounded-2xl border border-border bg-surface p-5" data-testid="wallet-gate">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium">{title}</p>
        <span className="num text-xs text-muted">
          {Math.max(0, current)}/{steps.length}
        </span>
      </div>
      <div aria-hidden className="mt-3 h-1 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out" style={{ width: `${Math.max(progress * 100, 4)}%` }} />
      </div>
      <ol className="mt-4 space-y-2.5 text-sm">
        {steps.map((s, i) => (
          <li key={s} className={cn("flex items-center gap-2.5 transition-colors duration-300", i > current ? "text-muted" : "")}>
            <span
              className={cn(
                "grid size-5 shrink-0 place-items-center rounded-full border text-[11px] transition-colors duration-300",
                i < current ? "border-win bg-win text-bg" : i === current ? "border-accent text-accent" : "border-border",
                i === current && w.busy && "pulse-ring",
              )}
            >
              {i < current ? <Check aria-hidden className="stage-in size-3" /> : i === current && w.busy ? <Loader2 aria-hidden className="size-3 animate-spin" /> : i + 1}
            </span>
            {STEP_LABEL[s]}
            {i === current && w.busy ? <span className="text-xs text-muted">· confirm in your wallet</span> : null}
          </li>
        ))}
      </ol>
      {step === "no_key" ? (
        <p className="mt-3 text-xs text-muted">One signature creates a private key that only this device uses to unlock signals you buy. Sign again any time to get the same key back.</p>
      ) : null}
      <Button
        size="lg"
        variant="accent"
        className="mt-5 w-full"
        onClick={() => {
          setAuto(true);
          void go();
        }}
        disabled={Boolean(w.busy)}
        data-testid="wallet-next"
      >
        {w.busy ? <Loader2 aria-hidden className="animate-spin" /> : <Wallet aria-hidden />}
        {current <= 0 ? "Connect wallet" : w.error ? `Retry: ${STEP_LABEL[step as Exclude<WalletStep, "ready">].toLowerCase()}` : "Continue"}
      </Button>
      {w.error ? (
        <p role="alert" className="mt-3 text-sm text-loss">
          {w.error}
        </p>
      ) : null}
    </div>
  );
}
