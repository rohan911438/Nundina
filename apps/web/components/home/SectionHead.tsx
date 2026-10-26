import type { ReactNode } from "react";

export function SectionHead({ eyebrow, title, children }: { eyebrow: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-accent">{eyebrow}</p>
        <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
      </div>
      {children}
    </div>
  );
}
