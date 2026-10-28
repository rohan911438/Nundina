"use client";

import { useEffect, useState } from "react";

const DIGITS = "0123456789";
const HEX = "0123456789abcdef";
const pick = (set: string) => set[Math.floor(Math.random() * set.length)]!;
// digits roll as digits, hex letters as hex; punctuation ($ , . x …) stays put so the shape holds
const roll = (c: string) => (/\d/.test(c) ? pick(DIGITS) : /[a-f]/i.test(c) ? pick(HEX) : c);

/**
 * Text that "decrypts": its characters keep re-rolling and settle left to right on `final`.
 * Decorative: hidden from screen readers (pair it with an sr-only copy), static under reduced motion.
 */
export function Scramble({ final, className, step = 45 }: { final: string; className?: string; step?: number }) {
  const [text, setText] = useState(final);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let locked = 0;
    let frame = 0;
    const id = setInterval(() => {
      frame++;
      if (frame % 3 === 0) locked++;
      setText(final.slice(0, locked) + [...final.slice(locked)].map(roll).join(""));
      if (locked >= final.length) clearInterval(id);
    }, step);
    return () => clearInterval(id);
  }, [final, step]);

  return (
    <span aria-hidden className={className}>
      {text}
    </span>
  );
}

/** A commit hash settling into place. */
export const HashScramble = Scramble;
