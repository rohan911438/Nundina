"use client";

import { useEffect, useRef, useState, type ElementType, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/** `null` until mounted (server HTML stays visible), then false until the element scrolls into view. */
export function useInView<T extends Element>(opts: { margin?: string; once?: boolean } = {}) {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState<boolean | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return setShown(true);
    setShown(false);
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setShown(true);
          if (opts.once !== false) io.disconnect();
        } else if (opts.once === false) setShown(false);
      },
      { rootMargin: opts.margin ?? "0px 0px -12% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [opts.margin, opts.once]);
  return { ref, shown };
}

/**
 * Fades and lifts its content in when scrolled into view. Children marked `.reveal-child` follow in
 * sequence (set `--i` on each for the stagger). Content is visible without JS and with reduced motion.
 */
export function Reveal({ as: Tag = "div", className, children, ...rest }: { as?: ElementType; className?: string; children: ReactNode } & Record<string, unknown>) {
  const { ref, shown } = useInView<HTMLElement>();
  return (
    <Tag ref={ref} data-reveal={shown === null ? undefined : shown ? "in" : "out"} className={cn("reveal", className)} {...rest}>
      {children}
    </Tag>
  );
}
