"use client";

import { useEffect, useState } from "react";
import { useInView } from "./Reveal";

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Counts the number inside a formatted string ("$1,240.50", "38", "1.2K") up from zero when it
 * scrolls into view, keeping the prefix, suffix, separators and decimals. Renders the final text on
 * the server, so there's no layout shift and nothing is wrong without JS.
 */
export function CountUp({ value, ms = 1100 }: { value: string; ms?: number }) {
  const m = value.match(/^(\D*)([\d,]+(?:\.\d+)?)(.*)$/);
  const { ref, shown } = useInView<HTMLSpanElement>();
  const [text, setText] = useState(value);

  useEffect(() => {
    if (!m || !shown || reduced()) return setText(value);
    const [, pre, num, post] = m;
    const target = Number(num!.replace(/,/g, ""));
    const decimals = num!.split(".")[1]?.length ?? 0;
    const grouped = num!.includes(",");
    if (!Number.isFinite(target) || target === 0) return setText(value);
    const fmt = (n: number) => `${pre}${n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: grouped })}${post}`;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setText(fmt(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, value, ms]);

  return (
    <span ref={ref} aria-label={value}>
      <span aria-hidden>{text}</span>
    </span>
  );
}
