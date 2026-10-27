"use client";

import { CountUp } from "@/components/motion/CountUp";
import { useInView } from "@/components/motion/Reveal";
import { cn } from "@/lib/cn";

/** Score out of 100 as a ring that sweeps in when visible. Probation shows a dashed, empty ring. */
export function ScoreRing({ score, size = 112 }: { score: number | null; size?: number }) {
  const { ref, shown } = useInView<HTMLDivElement>();
  const r = 44;
  const c = 2 * Math.PI * r;
  const v = score == null ? 0 : Math.max(0, Math.min(100, score));
  const tone = v >= 70 ? "var(--win)" : v >= 40 ? "var(--accent)" : "var(--locked)";
  return (
    <div ref={ref} className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--border)" strokeWidth="6" strokeDasharray={score == null ? "2 4" : undefined} />
        {score != null ? (
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke={tone}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={shown === false ? c : c * (1 - v / 100)}
            className="transition-[stroke-dashoffset] duration-[1200ms] ease-[cubic-bezier(.2,.7,.2,1)] motion-reduce:transition-none"
          />
        ) : null}
      </svg>
      <span className={cn("num text-4xl font-medium leading-none tracking-tight", score == null && "text-muted")}>
        {score == null ? "—" : <CountUp value={v.toFixed(0)} />}
      </span>
    </div>
  );
}
