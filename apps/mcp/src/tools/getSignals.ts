import { z } from "zod";
import { NOT_ADVICE, guarded, ok, type Ctx } from "./common.js";

const STATUS = { live: "COMMITTED", settled: "SETTLED,RESOLVED,REFUNDED,UNREVEALED_LOSS", revealed: "REVEALED" } as const;

export const getSignalsInput = {
  status: z.enum(["live", "settled", "revealed"]).default("live").describe("live = committed and still sealed (buyable); settled = outcome decided"),
  market: z.enum(["BTC/USD", "HSK/USD"]).optional(),
  provider: z.string().optional().describe("Provider handle"),
  limit: z.number().int().min(1).max(100).default(20),
};

export const signalSummary = z.object({
  id: z.string(),
  provider: z.string().nullable(),
  providerKind: z.string().nullable(),
  market: z.string(),
  status: z.string(),
  outcome: z.string().nullable(),
  rMultiple: z.number().nullable(),
  priceUsd: z.string(),
  validUntil: z.string(),
  committedAt: z.string(),
  side: z.string().nullable(),
  entry: z.string().nullable(),
  takeProfit: z.string().nullable(),
  stopLoss: z.string().nullable(),
  buyers: z.number(),
  upstream: z.unknown(),
});
export const getSignalsOutput = { signals: z.array(signalSummary), note: z.string() };

export const getSignalsMeta = {
  title: "List signals",
  description: `Free. Signal summaries. Live signals are sealed: side and levels stay null until reveal (buy one with buy_signal to read it). Settled signals show the plaintext, outcome and R multiple. ${NOT_ADVICE}`,
};

export const summarize = (s: any) => ({
  id: s.id,
  provider: s.provider?.handle ?? null,
  providerKind: s.provider?.kind ?? null,
  market: s.market,
  status: s.status,
  outcome: s.outcome,
  rMultiple: s.rMultiple,
  priceUsd: s.priceUsd,
  validUntil: s.validUntil,
  committedAt: s.committedAt,
  side: s.side,
  entry: s.entry,
  takeProfit: s.takeProfit,
  stopLoss: s.stopLoss,
  buyers: s.purchaseCount,
  upstream: s.upstream ?? null,
});

export function getSignals(ctx: Ctx) {
  return (a: { status: keyof typeof STATUS; market?: string; provider?: string; limit: number }) =>
    guarded(async () => {
      const q = new URLSearchParams({ status: STATUS[a.status], limit: String(a.limit), ...(a.market ? { market: a.market } : {}), ...(a.provider ? { provider: a.provider } : {}) });
      const r = await ctx.anon.get<{ items: any[] }>(`/signals?${q}`);
      const now = Date.now();
      const items = r.items.filter((s) => a.status !== "live" || new Date(s.validUntil).getTime() > now);
      return ok({ signals: items.map(summarize), note: NOT_ADVICE });
    });
}
