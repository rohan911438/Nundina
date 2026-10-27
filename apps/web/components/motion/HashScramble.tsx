"use client";

import { useEffect, useState } from "react";

const HEX = "0123456789abcdef";
const rand = (n: number) => Array.from({ length: n }, () => HEX[Math.floor(Math.random() * 16)]).join("");

/**
 * A commit hash that keeps re-rolling, settling left to right on `final`. Decorative: hidden from
 * screen readers, and static under reduced motion.
 */
export function HashScramble({ final, className }: { final: string; className?: string }) {
  const [text, setText] = useState(final);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let locked = 0;
    let frame = 0;
    const id = setInterval(() => {
      frame++;
      if (frame % 3 === 0 && locked < final.length) locked++;
      setText(final.slice(0, locked) + rand(final.length - locked));
      if (locked >= final.length) clearInterval(id);
    }, 45);
    return () => clearInterval(id);
  }, [final]);

  return (
    <span aria-hidden className={className}>
      {text}
    </span>
  );
}
