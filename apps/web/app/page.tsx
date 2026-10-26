import type { ApiPage, ApiProvider, ApiSignal, ApiStats } from "@nundina/shared";
import { ForAgents } from "@/components/home/ForAgents";
import { Hero } from "@/components/home/Hero";
import { HowItWorks } from "@/components/home/HowItWorks";
import { LiveTicker } from "@/components/home/LiveTicker";
import { Numbers } from "@/components/home/Numbers";
import { TopProviders } from "@/components/home/TopProviders";
import { TrustRules } from "@/components/home/TrustRules";
import { api, SETTLED_STATUSES } from "@/lib/api";

export const revalidate = 30;

const empty = <T,>(): ApiPage<T> => ({ items: [], nextCursor: null });

export default async function Home() {
  // the page still renders (with empty sections) if the API is down
  const [settled, top, stats] = await Promise.all([
    api.signals({ status: SETTLED_STATUSES, limit: 10 }).catch(() => empty<ApiSignal>()),
    api.providers({ sort: "score", period: "all", limit: 3 }).catch(() => empty<ApiProvider>()),
    api.stats().catch((): ApiStats | null => null),
  ]);
  const latest = settled.items.find((s) => s.revealed && s.outcome !== "VOID") ?? null;

  return (
    <>
      <Hero latest={latest} />
      <LiveTicker initial={settled} />
      <HowItWorks />
      <Numbers stats={stats} />
      <TrustRules />
      <TopProviders providers={top.items} />
      <ForAgents />
    </>
  );
}
