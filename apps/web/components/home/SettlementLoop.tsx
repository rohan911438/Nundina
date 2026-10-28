"use client";

import { Check, Lock, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * Hero motion graphic: one signal's life on a loop. Lock → Pay → price moves → settle, alternating a
 * right call (provider paid) and a wrong one (buyer refunded plus bond). Illustrative numbers, labelled
 * as such; with reduced motion it holds the settled frame.
 */
const PHASES = [
  { key: "lock", label: "Lock", ms: 2200 },
  { key: "pay", label: "Pay", ms: 2200 },
  { key: "move", label: "Settle", ms: 2600 },
  { key: "done", label: "Prove", ms: 3200 },
] as const;
type Phase = (typeof PHASES)[number]["key"];

// chart geometry (viewBox 320 × 150): TP at y=22, entry at y=78, SL at y=128
const WIN_PATH = "M0 78 L28 74 L52 82 L78 70 L104 76 L130 60 L156 66 L184 48 L210 54 L236 38 L262 42 L290 24 L320 22";
const LOSS_PATH = "M0 78 L28 82 L52 72 L78 86 L104 80 L130 96 L156 90 L184 108 L210 102 L236 118 L262 112 L290 126 L320 128";

export function SettlementLoop() {
  const [i, setI] = useState(3);
  const [win, setWin] = useState(true);
  const [still, setStill] = useState(true);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    setStill(false);
    setI(0);
  }, []);

  useEffect(() => {
    if (still) return;
    const t = setTimeout(() => {
      if (i === PHASES.length - 1) setWin((w) => !w);
      setI((n) => (n + 1) % PHASES.length);
    }, PHASES[i]!.ms);
    return () => clearTimeout(t);
  }, [i, still]);

  const phase: Phase = PHASES[i]!.key;
  const at = (p: Phase) => PHASES.findIndex((x) => x.key === p) <= i;
  const revealed = at("pay");
  const drawn = at("move");
  const settled = phase === "done";
  // where the money is: payer → escrow → provider (win) or back to the payer (loss)
  const coin = phase === "lock" ? 0 : phase === "pay" || phase === "move" ? 50 : win ? 100 : 0;

  return (
    <figure className="relative" aria-label="Illustration: how a signal settles on Nundina">
      <div aria-hidden className="absolute -inset-6 -z-10 rounded-[2rem] bg-[radial-gradient(closest-side,var(--glow),transparent)] blur-2xl" />
      <div className="overflow-hidden rounded-2xl border border-border bg-surface/90 shadow-[0_30px_80px_-40px_rgb(0_0_0/0.5)] backdrop-blur">
        {/* header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div className="flex items-baseline gap-2">
            <span className="font-semibold">BTC/USD</span>
            <span className={cn("text-sm font-medium transition-colors duration-500", revealed ? "text-win" : "text-muted")}>{revealed ? "LONG" : "•••"}</span>
          </div>
          <StatusPill phase={phase} win={win} />
        </div>

        {/* chart */}
        <div className="relative px-5 pt-4">
          <svg viewBox="0 0 320 150" className="h-auto w-full overflow-visible" aria-hidden>
            <defs>
              <linearGradient id="sl-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={win ? "var(--win)" : "var(--loss)"} stopOpacity="0.22" />
                <stop offset="100%" stopColor={win ? "var(--win)" : "var(--loss)"} stopOpacity="0" />
              </linearGradient>
            </defs>
            <Level y={22} label="TP" tone="var(--win)" shown={revealed} />
            <Level y={78} label="Entry" tone="var(--muted)" shown />
            <Level y={128} label="SL" tone="var(--loss)" shown={revealed} />
            <path
              key={`fill-${win}-${drawn}`}
              d={`${win ? WIN_PATH : LOSS_PATH} L320 150 L0 150 Z`}
              fill="url(#sl-fill)"
              className={cn("transition-opacity duration-700", drawn ? "opacity-100 delay-1000" : "opacity-0")}
            />
            <path
              key={`line-${win}-${drawn}`}
              d={win ? WIN_PATH : LOSS_PATH}
              fill="none"
              stroke={win ? "var(--win)" : "var(--loss)"}
              strokeWidth="2.25"
              strokeLinejoin="round"
              strokeLinecap="round"
              pathLength={1}
              className={cn(drawn ? (still ? "" : "draw-line") : "opacity-0")}
            />
            {settled ? (
              <circle cx="320" cy={win ? 22 : 128} r="5" fill={win ? "var(--win)" : "var(--loss)"} className={still ? "" : "ping-dot"} />
            ) : null}
          </svg>
          {/* encrypted levels until the key arrives */}
          <div
            className={cn(
              "pointer-events-none absolute inset-x-5 top-4 flex h-[calc(100%-1rem)] items-center justify-center rounded-xl bg-surface/60 backdrop-blur-[6px] transition-opacity duration-700",
              revealed ? "opacity-0" : "opacity-100",
            )}
          >
            <span className="flex items-center gap-2 rounded-full border border-locked/40 bg-locked/10 px-3 py-1 text-xs text-locked">
              <Lock aria-hidden className="size-3.5" /> Levels encrypted on-chain
            </span>
          </div>
        </div>

        {/* money flow */}
        <div className="px-5 pb-4 pt-2">
          <div className="relative mx-3 mt-2 h-px bg-border">
            <span
              aria-hidden
              className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent)_25%,transparent),0_0_18px_var(--accent)] transition-[left] duration-[1400ms] ease-[cubic-bezier(.6,0,.2,1)]"
              style={{ left: `${coin}%` }}
            />
          </div>
          <div className="mt-3 grid grid-cols-3 text-xs">
            <Node label="Buyer" sub={settled && !win ? "refund + bond" : "0.50 USDT"} active={coin === 0 && phase !== "lock"} tone={settled && !win ? "win" : undefined} />
            <Node label="Escrow" sub="HashKey Chain" active={coin === 50} className="text-center" />
            <Node label="Provider" sub={settled && win ? "paid" : "bond at stake"} active={coin === 100} className="text-right" tone={settled && win ? "win" : undefined} />
          </div>
        </div>

        {/* steps */}
        <ol className="grid grid-cols-4 border-t border-border">
          {PHASES.map((p, n) => (
            <li key={p.key} className="relative px-3 py-2.5 text-center text-xs">
              <span className={cn("transition-colors duration-300", n === i ? "text-text" : n < i ? "text-muted" : "text-muted/50")}>{p.label}</span>
              <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-border">
                <span
                  key={`${p.key}-${i}`}
                  className={cn("block h-full bg-accent", n < i || still ? "w-full" : n === i ? "step-fill" : "w-0")}
                  style={n === i && !still ? { animationDuration: `${p.ms}ms` } : undefined}
                />
              </span>
            </li>
          ))}
        </ol>
      </div>
      <figcaption className="mt-3 text-center text-xs text-muted">Illustration · how every signal settles</figcaption>
    </figure>
  );
}

function Level({ y, label, tone, shown }: { y: number; label: string; tone: string; shown: boolean }) {
  return (
    <g className={cn("transition-opacity duration-700", shown ? "opacity-100" : "opacity-0")}>
      <line x1="0" x2="320" y1={y} y2={y} stroke={tone} strokeOpacity="0.45" strokeDasharray="3 5" />
      <text x="2" y={y - 5} fontSize="9" fill={tone} className="num">
        {label}
      </text>
    </g>
  );
}

function Node({ label, sub, active, className, tone }: { label: string; sub: string; active: boolean; className?: string; tone?: "win" }) {
  return (
    <div className={cn("transition-opacity duration-500", active ? "opacity-100" : "opacity-60", className)}>
      <p className="font-medium">{label}</p>
      <p className={cn("num mt-0.5 text-[11px] text-muted transition-colors", tone === "win" && "text-win")}>{sub}</p>
    </div>
  );
}

function StatusPill({ phase, win }: { phase: Phase; win: boolean }) {
  const s =
    phase === "lock"
      ? { Icon: Lock, text: "Committed", tone: "border-locked/40 bg-locked/10 text-locked" }
      : phase === "pay"
        ? { Icon: Check, text: "Paid · key sent", tone: "border-accent/40 bg-accent/10 text-accent" }
        : phase === "move"
          ? { Icon: RotateCcw, text: "Oracle watching", tone: "border-border bg-surface-2 text-muted" }
          : win
            ? { Icon: Check, text: "Right · provider paid", tone: "border-win/40 bg-win/10 text-win" }
            : { Icon: X, text: "Wrong · refunded", tone: "border-loss/40 bg-loss/10 text-loss" };
  return (
    <span key={`${phase}-${win}`} className={cn("pill-in inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium", s.tone)}>
      <s.Icon aria-hidden className={cn("size-3.5", phase === "move" && "animate-spin [animation-duration:2.5s]")} />
      {s.text}
    </span>
  );
}
