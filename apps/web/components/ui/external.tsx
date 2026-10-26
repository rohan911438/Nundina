import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** The small "↗ explorer" link every on-chain fact gets. */
export function ExternalLink({
  href,
  children,
  className,
  label,
}: {
  href: string | null | undefined;
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  if (!href) return <span className={cn("num", className)}>{children}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className={cn("num inline-flex items-center gap-0.5 underline-offset-4 hover:text-accent hover:underline", className)}
    >
      {children}
      {/* appended, not aria-label, so the accessible name still starts with the visible text */}
      {label ? <span className="sr-only">, {label}</span> : null}
      <ArrowUpRight aria-hidden className="size-3 shrink-0 opacity-70" />
    </a>
  );
}
