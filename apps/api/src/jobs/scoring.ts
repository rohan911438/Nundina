import { and, asc, eq, gte, isNotNull, lte, desc, sql as dsql } from "drizzle-orm";
import { fromPrice, scoreProvider, type ScoringSignal } from "@nundina/shared";
import { db } from "../db/client.js";
import { agentActions, priceCandles, providerScores, providers, signals } from "../db/schema.js";
import { log } from "../lib/log.js";
import { getCandles } from "../services/prices.js";

const DAY_MS = 86_400_000;
export const PERIODS = { "7d": 7 * DAY_MS, "30d": 30 * DAY_MS, all: Infinity } as const;
export const SCORE_MARKETS = ["all", "BTC/USD", "HSK/USD"] as const;

export interface RecomputeOptions {
  /** Fetch missing BTC candles from the exchange (off in tests and seeding). */
  fetchPrices?: boolean;
  now?: number;
}

/** BTC close of the 1h candle containing `t` (cache first, optional fetch). */
async function btcAt(t: number, fetchPrices: boolean): Promise<number | undefined> {
  const hour = Math.floor(t / 3_600_000) * 3_600_000;
  const read = () =>
    db()
      .select({ close: priceCandles.close })
      .from(priceCandles)
      .where(
        and(
          eq(priceCandles.market, "BTC/USD"),
          eq(priceCandles.interval, "1h"),
          lte(priceCandles.openTime, new Date(hour)),
          gte(priceCandles.openTime, new Date(hour - 3 * 3_600_000)),
        ),
      )
      .orderBy(desc(priceCandles.openTime))
      .limit(1);
  let [row] = await read();
  if (!row && fetchPrices && hour + 3_600_000 <= Date.now()) {
    await getCandles("BTC/USD", "1h", hour - 3 * 3_600_000, hour + 3_600_000).catch(() => undefined);
    [row] = await read();
  }
  return row ? Number(row.close) : undefined;
}

type SignalRow = typeof signals.$inferSelect;

/** Turns a decided signal row into a scoring input (exit price derived from the R multiple). */
async function toScoring(s: SignalRow, opts: RecomputeOptions, follower?: number): Promise<ScoringSignal> {
  const outcome = s.status === "UNREVEALED_LOSS" ? "UNREVEALED" : ((s.outcome ?? "LOSS") as ScoringSignal["outcome"]);
  const r = s.rMultiple == null ? (outcome === "WIN" ? 1 : -1) : Number(s.rMultiple);
  const committedAt = s.committedAt.getTime();
  const decidedAt = (s.decidedAt ?? s.validUntil).getTime();
  const base: ScoringSignal = {
    outcome,
    rMultiple: r,
    committedAt: committedAt / 1000,
    decidedAt: decidedAt / 1000,
    market: s.market,
    followerPnlPct: follower,
  };
  if (s.side == null || !s.entry || !s.sl) return base;
  const entry = Number(fromPrice(BigInt(s.entry)));
  const sl = Number(fromPrice(BigInt(s.sl)));
  const side = s.side === 0 ? "LONG" : "SHORT";
  const risk = Math.abs(entry - sl);
  const realisedR = outcome === "WIN" ? r : -1;
  const exitPrice = entry + (side === "LONG" ? 1 : -1) * realisedR * risk;
  const fetchPrices = opts.fetchPrices ?? true;
  return {
    ...base,
    side,
    entry,
    exitPrice,
    btcAtCommit: await btcAt(committedAt, fetchPrices),
    btcAtExit: await btcAt(decidedAt, fetchPrices),
  };
}

/** Recomputes `provider_scores` for one provider: periods × markets. */
export async function recomputeProvider(providerId: number, opts: RecomputeOptions = {}) {
  const now = opts.now ?? Date.now();
  const p = await db().query.providers.findFirst({ where: eq(providers.id, providerId) });
  if (!p) return;
  const rows = await db()
    .select()
    .from(signals)
    .where(and(eq(signals.providerId, providerId), isNotNull(signals.outcome)))
    .orderBy(asc(signals.decidedAt));
  const follow = await db()
    .select({
      signalId: agentActions.signalId,
      pnl: dsql<string>`avg((${agentActions.fillJson}->>'pnlPct')::numeric)`,
    })
    .from(agentActions)
    .where(and(eq(agentActions.decision, "trade"), isNotNull(agentActions.fillJson)))
    .groupBy(agentActions.signalId);
  const followBy = new Map(follow.filter((f) => f.signalId != null && f.pnl != null).map((f) => [f.signalId!.toString(), Number(f.pnl)]));

  const inputs = await Promise.all(rows.map((s) => toScoring(s, opts, followBy.get(s.id.toString()))));
  const values: (typeof providerScores.$inferInsert)[] = [];
  for (const [period, span] of Object.entries(PERIODS)) {
    for (const market of SCORE_MARKETS) {
      const slice = inputs.filter((x) => now - x.decidedAt * 1000 <= span && (market === "all" || x.market === market));
      const b = scoreProvider(slice);
      values.push({
        providerId,
        period,
        market,
        n: b.n,
        wins: b.wins,
        losses: b.losses,
        voids: b.voids,
        winRate: b.winRate.toFixed(4),
        wilsonLb: b.wilsonLb.toFixed(4),
        expectancyR: b.expectancyR.toFixed(4),
        alphaBtc: (b.alphaPct ?? 0).toFixed(4),
        maxDd: b.maxDrawdownR.toFixed(4),
        followerPnl: (b.followerPnlPct ?? 0).toFixed(2),
        score: (b.score ?? 0).toFixed(2),
        ranked: !b.probation && !p.isPractice,
        updatedAt: new Date(),
      });
    }
  }
  await db()
    .insert(providerScores)
    .values(values)
    .onConflictDoUpdate({
      target: [providerScores.providerId, providerScores.period, providerScores.market],
      set: {
        n: dsql`excluded.n`,
        wins: dsql`excluded.wins`,
        losses: dsql`excluded.losses`,
        voids: dsql`excluded.voids`,
        winRate: dsql`excluded.win_rate`,
        wilsonLb: dsql`excluded.wilson_lb`,
        expectancyR: dsql`excluded.expectancy_r`,
        alphaBtc: dsql`excluded.alpha_btc`,
        maxDd: dsql`excluded.max_dd`,
        followerPnl: dsql`excluded.follower_pnl`,
        score: dsql`excluded.score`,
        ranked: dsql`excluded.ranked`,
        updatedAt: dsql`excluded.updated_at`,
      },
    });
  log.debug({ providerId, signals: rows.length }, "scores recomputed");
}

export async function recomputeAll(opts: RecomputeOptions = {}) {
  const all = await db().select({ id: providers.id }).from(providers);
  for (const p of all) await recomputeProvider(p.id, opts);
  return all.length;
}
