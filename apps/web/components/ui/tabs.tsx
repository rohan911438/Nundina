"use client";

import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Segmented tabs with an indicator that slides to the selected tab. Arrow keys move between tabs
 * (roving tabindex), as the WAI-ARIA tabs pattern expects.
 */
export function Tabs<K extends string>({
  value,
  onChange,
  items,
  label,
}: {
  value: K;
  onChange: (k: K) => void;
  items: readonly { key: K; label: ReactNode; count?: number }[];
  label: string;
}) {
  const list = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const el = list.current?.querySelector<HTMLElement>('[aria-selected="true"]');
      if (el) setPill({ left: el.offsetLeft, width: el.offsetWidth });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [value, items.length]);

  function onKey(e: KeyboardEvent) {
    const i = items.findIndex((x) => x.key === value);
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = items[(i + d + items.length) % items.length]!.key;
    onChange(next);
    list.current?.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus();
  }

  return (
    <div ref={list} role="tablist" aria-label={label} onKeyDown={onKey} className="relative flex gap-1 rounded-full border border-border p-1 text-sm">
      {pill ? (
        <span
          aria-hidden
          className="absolute inset-y-1 rounded-full bg-surface-2 transition-[left,width] duration-300 ease-[var(--ease-out)] motion-reduce:transition-none"
          style={{ left: pill.left, width: pill.width }}
        />
      ) : null}
      {items.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          data-tab={t.key}
          aria-selected={value === t.key}
          tabIndex={value === t.key ? 0 : -1}
          onClick={() => onChange(t.key)}
          className={cn(
            "relative flex-1 rounded-full px-3 py-1.5 transition-colors duration-200",
            value === t.key ? "text-text" : "text-muted hover:text-text",
            !pill && value === t.key && "bg-surface-2",
          )}
        >
          {t.label} {t.count != null ? <span className="num text-xs text-muted">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
