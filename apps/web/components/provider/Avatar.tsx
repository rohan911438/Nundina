import { cn } from "@/lib/cn";

/** Initials on a hue derived from the handle; no external images on public pages. */
export function Avatar({ handle, name, className }: { handle: string; name: string; className?: string }) {
  let h = 0;
  for (const c of handle) h = (h * 31 + c.charCodeAt(0)) % 360;
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span
      aria-hidden
      className={cn("grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold text-white", className)}
      style={{ background: `linear-gradient(135deg, hsl(${h} 55% 42%), hsl(${(h + 40) % 360} 60% 30%))` }}
    >
      {initials}
    </span>
  );
}
