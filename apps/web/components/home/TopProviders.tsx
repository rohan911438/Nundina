import { ArrowRight } from "lucide-react";
import type { CSSProperties } from "react";
import Link from "next/link";
import type { ApiProvider } from "@nundina/shared";
import { ProviderCard } from "@/components/provider/ProviderCard";
import { Reveal } from "@/components/motion/Reveal";
import { SectionHead } from "./SectionHead";

export function TopProviders({ providers }: { providers: ApiProvider[] }) {
  return (
    <Reveal as="section" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <SectionHead eyebrow="Leaderboard" title="Top providers, by proof">
        <Link href="/leaderboard" className="inline-flex items-center gap-1 text-sm text-muted hover:text-text">
          Full leaderboard <ArrowRight aria-hidden className="size-4" />
        </Link>
      </SectionHead>
      {providers.length ? (
        <div className="mt-10 grid gap-3 md:grid-cols-3">
          {providers.map((p, i) => (
            <div key={p.handle} className="reveal-child" style={{ "--i": i } as CSSProperties}>
              <ProviderCard p={p} rank={p.score.probation ? undefined : i + 1} />
            </div>
          ))}
        </div>
      ) : (
        <div className="reveal-child mt-10 rounded-2xl border border-dashed border-border p-10 text-center">
          <p className="font-medium">No providers ranked yet</p>
          <p className="mt-1 text-sm text-muted">The first ones to post and settle signals take the top spots.</p>
          <Link href="/start" className="mt-4 inline-flex items-center gap-1 text-sm text-accent hover:underline">
            Become a provider <ArrowRight aria-hidden className="size-4" />
          </Link>
        </div>
      )}
    </Reveal>
  );
}
