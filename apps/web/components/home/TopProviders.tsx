import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ApiProvider } from "@nundina/shared";
import { ProviderCard } from "@/components/provider/ProviderCard";
import { SectionHead } from "./SectionHead";

export function TopProviders({ providers }: { providers: ApiProvider[] }) {
  return (
    <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <SectionHead eyebrow="Leaderboard" title="Top providers, by proof">
        <Link href="/leaderboard" className="inline-flex items-center gap-1 text-sm text-muted hover:text-text">
          Full leaderboard <ArrowRight aria-hidden className="size-4" />
        </Link>
      </SectionHead>
      {providers.length ? (
        <div className="mt-10 grid gap-3 md:grid-cols-3">
          {providers.map((p, i) => (
            <ProviderCard key={p.handle} p={p} rank={p.score.probation ? undefined : i + 1} />
          ))}
        </div>
      ) : (
        <p className="mt-10 rounded-2xl border border-dashed border-border p-10 text-center text-muted">No providers yet.</p>
      )}
    </section>
  );
}
