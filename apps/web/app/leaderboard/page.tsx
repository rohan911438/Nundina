import type { Metadata } from "next";
import { LeaderboardFilters } from "@/components/provider/LeaderboardFilters";
import { LeaderboardTable } from "@/components/provider/LeaderboardTable";
import { api } from "@/lib/api";
import { parseFilters, type Search } from "@/lib/leaderboard";

export const metadata: Metadata = {
  title: "Leaderboard",
  description: "Signal providers ranked by settled, on-chain results: Wilson win-rate bound, expectancy in R and alpha vs BTC.",
};

export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<Search> }) {
  const filters = parseFilters(await searchParams);
  const data = await api.providers({ ...filters, limit: 100 }).catch(() => null);

  return (
    <div className="group/lb mx-auto max-w-6xl px-4 pb-10 pt-12 sm:px-6 sm:pt-16">
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Leaderboard</h1>
      <p className="mt-3 max-w-2xl text-muted">
        Ranked only on signals committed before the move and settled by oracles. Providers need 30 settled signals before they get a rank.
      </p>
      <div className="mt-8">
        <LeaderboardFilters value={filters} />
      </div>
      {/* dims while a filter change is loading (the filter bar sets data-pending) */}
      <div className="mt-6 transition-opacity duration-200 group-has-[[data-pending]]/lb:pointer-events-none group-has-[[data-pending]]/lb:opacity-50">
        {data == null ? (
          <Empty title="The leaderboard is unavailable" body="We couldn't reach the API. Try again in a moment." />
        ) : data.items.length === 0 ? (
          <Empty title="No providers match these filters" body="Try a longer period or clear the filters." />
        ) : (
          <LeaderboardTable providers={data.items} filters={filters} />
        )}
      </div>
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border p-12 text-center">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted">{body}</p>
    </div>
  );
}
