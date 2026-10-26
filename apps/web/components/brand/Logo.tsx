import { cn } from "@/lib/cn";

/** Mark: a sealed commitment (rounded square) with the "right call" tick cut out of it. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-6", className)}>
      <rect x="2" y="2" width="28" height="28" rx="9" fill="currentColor" />
      <path d="M9.5 16.5l4.5 4.5 8.5-9.5" fill="none" stroke="var(--bg)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <LogoMark />
      <span>nundina</span>
    </span>
  );
}
