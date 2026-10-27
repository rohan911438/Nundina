import { z } from "zod";
import { fromPrice, scoreProvider, type ScoringSignal } from "@nundina/shared";
import { env } from "../env.js";
import { onchainSignal, txUrl } from "../chain.js";
import { charge } from "../paywall.js";
import { NOT_ADVICE, fail, guarded, ok, type Ctx } from "./common.js";

export const verifyTrackRecordInput = {
  handle: z.string().min(1).describe("Provider handle"),
  payment: z.string().optional().describe("x402 PaymentPayload, base64 (exact scheme, USDC.e EIP-3009). Omit to pay from prepaid API-key credit."),
};

export const verifyTrackRecordOutput = {
  provider: z.string(),
  paid: z.record(z.string(), z.unknown()),
  recomputed: z.record(z.string(), z.unknown()),
  reported: z.record(z.string(), z.unknown()).nullable(),
  matches: z.boolean(),
  mismatches: z.array(z.string()),
  signals: z.array(z.record(z.string(), z.unknown())),
  method: z.string(),
  note: z.string(),
};

export const verifyTrackRecordMeta = (price: string) => ({
  title: "Verify a provider's track record",
  description: `PAID: ${price} USDC.e per call (x402 via the HSP facilitator, or prepaid credit on your API key). Re-reads every decided signal of a provider from the chain (SignalBook status + commit hash, OutcomeResolver outcome + R multiple, revealed levels), recomputes the score with the open scoring code (@nundina/shared/scoring), compares it with the score Nundina reports, and returns every transaction hash so you can check independently. ${NOT_ADVICE}`,
});

const DECIDED = "SETTLED,RESOLVED,REFUNDED,UNREVEALED_LOSS";
const HOUR = 3_600_000;

/** BTC close of the 1h candle containing `t` (same rule as the scoring job: up to 3 h back). */
async function btcAt(ctx: Ctx, t: number, cache: Map<number, number | undefined>) {
  const hour = Math.floor(t / HOUR) * HOUR;
  if (cache.has(hour)) return cache.get(hour);
  const r = await ctx.anon.get<{ candles: { t: number; c: string | number }[] }>(`/prices?market=BTC/USD&interval=1h&from=${hour - 3 * HOUR}&to=${hour + HOUR}`).catch(() => ({ candles: [] }));
  const c = r.candles.filter((x) => x.t <= hour).sort((a, b) => b.t - a.t)[0];
  const v = c ? Number(c.c) : undefined;
  cache.set(hour, v);
  return v;
}

const round = (v: number | null, dp = 2) => (v == null ? null : Math.round(v * 10 ** dp) / 10 ** dp);

export function verifyTrackRecord(ctx: Ctx) {
  return (a: { handle: string; payment?: string }) =>
    guarded(async () => {
      const profile = await ctx.anon.get<any>(`/providers/${encodeURIComponent(a.handle)}`); // 404 before charging
      const price = env().VERIFY_PRICE_UNITS;
      const paid = await charge({ tool: "verify_track_record", price, description: `Track-record verification for @${a.handle}`, payment: a.payment ?? ctx.header("x-payment"), api: ctx.api });
      if ("error" in paid) return fail(paid.error, paid.message, { x402Version: paid.x402Version, accepts: paid.accepts, credits: paid.credits });

      // every decided signal, oldest decision first
      const rows: any[] = [];
      let cursor: string | null = null;
      do {
        const q = new URLSearchParams({ status: DECIDED, limit: "100", ...(cursor ? { cursor } : {}) });
        const page: { items: any[]; nextCursor: string | null } = await ctx.anon.get(`/providers/${encodeURIComponent(a.handle)}/signals?${q}`);
        rows.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor && rows.length < 2000);
      rows.sort((x, y) => Date.parse(x.decidedAt ?? x.validUntil) - Date.parse(y.decidedAt ?? y.validUntil));

      const mismatches: string[] = [];
      const prices = new Map<number, number | undefined>();
      const inputs: ScoringSignal[] = [];
      const signals: Record<string, unknown>[] = [];
      for (const s of rows) {
        const c = await onchainSignal(BigInt(s.id));
        if (c.commitHash.toLowerCase() !== String(s.commitHash).toLowerCase()) mismatches.push(`#${s.id}: commit hash differs from chain`);
        const outcome: ScoringSignal["outcome"] = c.status === "UNREVEALED_LOSS" ? "UNREVEALED" : c.outcome === "NONE" ? "LOSS" : c.outcome;
        if (c.outcome === "NONE" || !c.final) mismatches.push(`#${s.id}: chain outcome not final`);
        else if (s.outcome && s.outcome !== c.outcome && !(c.status === "UNREVEALED_LOSS" && s.outcome === "LOSS")) mismatches.push(`#${s.id}: API says ${s.outcome}, chain says ${c.outcome}`);
        const committedAt = c.committedAt * 1000;
        const decidedAt = Date.parse(s.decidedAt ?? s.validUntil);
        const base: ScoringSignal = { outcome, rMultiple: c.rMultiple, committedAt: committedAt / 1000, decidedAt: decidedAt / 1000, market: s.market };
        let input = base;
        if (c.revealed) {
          const entry = Number(fromPrice(c.revealed.entry));
          const sl = Number(fromPrice(c.revealed.stopLoss));
          const side = c.revealed.side === 0 ? "LONG" : "SHORT";
          const realisedR = outcome === "WIN" ? c.rMultiple : -1;
          input = {
            ...base,
            side,
            entry,
            exitPrice: entry + (side === "LONG" ? 1 : -1) * realisedR * Math.abs(entry - sl),
            btcAtCommit: await btcAt(ctx, committedAt, prices),
            btcAtExit: await btcAt(ctx, decidedAt, prices),
          };
        }
        inputs.push(input);
        signals.push({
          id: s.id,
          market: s.market,
          outcome,
          rMultiple: c.rMultiple,
          committedAt: new Date(committedAt).toISOString(),
          decidedAt: new Date(decidedAt).toISOString(),
          commitHash: c.commitHash,
          tx: { commit: s.tx?.commit ?? null, reveal: s.tx?.reveal ?? null, resolve: s.tx?.resolve ?? null },
          explorer: { commit: txUrl(s.tx?.commit), reveal: txUrl(s.tx?.reveal), resolve: txUrl(s.tx?.resolve) },
        });
      }

      const now = Date.now();
      const periods = { "7d": 7 * 86_400_000, "30d": 30 * 86_400_000, all: Infinity } as const;
      const recomputed: Record<string, unknown> = {};
      const reported: Record<string, unknown> = {};
      for (const [period, span] of Object.entries(periods)) {
        const b = scoreProvider(inputs.filter((x) => now - x.decidedAt * 1000 <= span));
        recomputed[period] = { n: b.n, wins: b.wins, losses: b.losses, voids: b.voids, winRate: round(b.winRate, 4), wilsonLb: round(b.wilsonLb, 4), expectancyR: round(b.expectancyR, 4), alphaPct: round(b.alphaPct, 4), maxDrawdownR: round(b.maxDrawdownR, 4), score: round(b.score), probation: b.probation };
        const rep = (profile.scores as any[] | undefined)?.find((x) => x.period === period && x.market === "all");
        if (rep) {
          reported[period] = { n: rep.n, wins: rep.wins, losses: rep.losses, winRate: rep.winRate, wilsonLb: rep.wilsonLb, expectancyR: rep.expectancyR, score: rep.score, probation: rep.probation };
          if (rep.n !== b.n || rep.wins !== b.wins) mismatches.push(`${period}: API reports n=${rep.n} wins=${rep.wins}, chain gives n=${b.n} wins=${b.wins}`);
          if (rep.score != null && b.score != null && Math.abs(rep.score - b.score) > 0.01) mismatches.push(`${period}: API score ${rep.score}, recomputed ${round(b.score)}`);
          if ((rep.score == null) !== (b.score == null)) mismatches.push(`${period}: probation status differs`);
          for (const [k, v] of [["winRate", b.winRate], ["wilsonLb", b.wilsonLb], ["expectancyR", b.expectancyR]] as const) {
            if (rep[k] != null && Math.abs(Number(rep[k]) - v) > 1e-3) mismatches.push(`${period}: API ${k} ${rep[k]}, recomputed ${round(v, 4)}`);
          }
        }
      }

      return ok({
        provider: a.handle,
        paid: paid as Record<string, unknown>,
        recomputed,
        reported: Object.keys(reported).length ? reported : null,
        matches: mismatches.length === 0,
        mismatches,
        signals,
        method: "Outcomes and R multiples from OutcomeResolver.outcomeOf; levels from SignalBook.revealedSignal; BTC reference prices are 1h closes (Binance, via /prices); score = @nundina/shared scoreProvider (40% Wilson LB, 30% expectancy, 20% alpha vs BTC, 10% drawdown).",
        note: NOT_ADVICE,
      });
    });
}
