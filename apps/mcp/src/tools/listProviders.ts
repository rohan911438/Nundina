import { z } from "zod";
import { NOT_ADVICE, guarded, ok, type Ctx } from "./common.js";

export const listProvidersInput = {
  market: z.enum(["BTC/USD", "HSK/USD"]).optional().describe("Only providers scored on this market"),
  minScore: z.number().min(0).max(100).optional().describe("Drop providers below this 0-100 score (providers in probation have no score)"),
  type: z.enum(["human", "agent", "aggregator"]).optional(),
  period: z.enum(["7d", "30d", "all"]).default("30d"),
  limit: z.number().int().min(1).max(100).default(20),
};

export const providerOut = z.object({
  handle: z.string(),
  displayName: z.string(),
  kind: z.string(),
  score: z.number().nullable(),
  probation: z.boolean(),
  n: z.number(),
  winRate: z.number(),
  wilsonLb: z.number(),
  expectancyR: z.number(),
  defaultPriceUsd: z.string(),
  bondUsd: z.string(),
  profileUrl: z.string(),
});
export const listProvidersOutput = { providers: z.array(providerOut), note: z.string() };

export const listProvidersMeta = {
  title: "List signal providers",
  description: `Free. Leaderboard of Nundina signal providers ranked by a 0-100 score (Wilson lower bound of win rate, expectancy in R, alpha vs BTC, drawdown), all computed from on-chain outcomes. Providers with fewer than 30 decided signals are in probation and have no score. ${NOT_ADVICE}`,
};

export function listProviders(ctx: Ctx, web: string) {
  return (a: { market?: string; minScore?: number; type?: string; period: string; limit: number }) =>
    guarded(async () => {
      const q = new URLSearchParams({ period: a.period, limit: String(a.limit), sort: "score", ...(a.market ? { market: a.market } : {}), ...(a.type ? { type: a.type } : {}) });
      const r = await ctx.anon.get<{ items: any[] }>(`/providers?${q}`);
      const providers = r.items
        .map((p) => ({
          handle: p.handle,
          displayName: p.displayName,
          kind: p.kind,
          score: p.score.score,
          probation: p.score.probation,
          n: p.score.n,
          winRate: p.score.winRate,
          wilsonLb: p.score.wilsonLb,
          expectancyR: p.score.expectancyR,
          defaultPriceUsd: p.defaultPriceUsd,
          bondUsd: p.bondUsd,
          profileUrl: `${web}/p/${p.handle}`,
        }))
        .filter((p) => a.minScore == null || (p.score != null && p.score >= a.minScore));
      return ok({ providers, note: NOT_ADVICE });
    });
}
