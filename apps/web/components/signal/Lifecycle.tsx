"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type CSSProperties } from "react";
import type { ApiSignalDetail } from "@nundina/shared";
import { cn } from "@/lib/cn";
import { hhmm } from "@/lib/format";
import type { SignalState } from "@/lib/signal-state";

const CHALLENGE_MS = 10 * 60_000;

type Step = { key: string; label: string; at: string | null; sub?: string };

/**
 * Commit → expiry/reveal → oracle decision → settlement, drawn as a track that fills up to where the
 * signal is now. While the signal is unresolved the page refreshes itself, so whoever is watching
 * sees the result land without reloading.
 */
export function Lifecycle({ s, st }: { s: ApiSignalDetail; st: SignalState }) {
  const router = useRouter();
  // null until mounted, so the server render and hydration agree (no clock-dependent text yet)
  const [now, setNow] = useState<number | null>(null);
  const open = st === "locked" || st === "live" || st === "resolving";

  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => router.refresh(), 20_000);
    return () => clearInterval(t);
  }, [open, router]);

  const decided = s.decidedAt ? Date.parse(s.decidedAt) : null;
  const challengeLeft = decided && !s.settlement && now != null ? decided + CHALLENGE_MS - now : null;
  const expired = now != null && Date.parse(s.validUntil) <= now;

  const steps: Step[] = [
    { key: "commit", label: "Committed", at: s.committedAt, sub: "levels hashed on-chain" },
    { key: "reveal", label: s.revealed ? "Revealed" : expired ? "Revealing" : "Expires", at: s.revealedAt ?? s.validUntil },
    {
      key: "decide",
      label: s.outcome ? `Oracle: ${s.outcome === "WIN" ? "TP touched" : s.outcome === "LOSS" ? "SL / loss" : s.outcome.toLowerCase()}` : "Oracle decides",
      at: s.decidedAt,
    },
    {
      key: "settle",
      label: s.settlement ? "Settled" : "Settlement",
      at: s.settlement?.settledAt ?? null,
      sub: challengeLeft != null && challengeLeft > 0 ? `challenge window ${mmss(challengeLeft)}` : challengeLeft != null ? "settling now" : undefined,
    },
  ];
  const reached = s.settlement ? 4 : s.decidedAt ? 3 : s.revealed ? 2 : 1;
  const tone = st === "win" ? "bg-win" : st === "loss" || st === "unrevealed" ? "bg-loss" : st === "void" || st === "refunded" ? "bg-void" : "bg-accent";

  return (
    <div data-testid="lifecycle">
      <div className="relative mx-[12.5%] h-0.5 rounded-full bg-border">
        <div
          aria-hidden
          className={cn("absolute inset-y-0 left-0 rounded-full transition-[width] duration-1000 ease-[var(--ease-out)]", tone)}
          style={{ width: `${((reached - 1) / (steps.length - 1)) * 100}%` }}
        />
      </div>
      <ol className="-mt-[7px] grid grid-cols-4 text-center text-xs">
        {steps.map((x, i) => {
          const done = i < reached;
          const current = i === reached && open;
          return (
            <li key={x.key} className="rise flex flex-col items-center" style={{ animationDelay: `${i * 90}ms` } as CSSProperties}>
              <span
                aria-hidden
                className={cn(
                  "size-3 rounded-full border-2 border-bg",
                  done ? tone : current ? "bg-accent text-accent pulse-ring" : "bg-border",
                )}
              />
              <span className={cn("mt-2 font-medium", !done && !current && "text-muted")}>{x.label}</span>
              <span className="num mt-0.5 text-muted">{x.at && (done || x.key === "reveal") ? hhmm(x.at) : "—"}</span>
              {x.sub ? <span className="mt-0.5 hidden text-[11px] text-muted sm:block">{x.sub}</span> : null}
            </li>
          );
        })}
      </ol>
      {challengeLeft != null && challengeLeft > 0 ? (
        <p className="mt-3 text-center text-xs text-muted sm:hidden">Challenge window closes in {mmss(challengeLeft)}</p>
      ) : null}
      <p className="sr-only" aria-live="polite">
        {steps[reached - 1]?.label}
      </p>
    </div>
  );
}

const mmss = (ms: number) => {
  const t = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};
