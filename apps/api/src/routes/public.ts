import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { and, count, desc, eq, inArray, lt, sql as dsql, sum, isNotNull } from "drizzle-orm";
import { MARKETS, fromUnits, isDeployed, deployment } from "@nundina/shared";
import * as abis from "@nundina/shared/abis";
import { db } from "../db/client.js";
import { providerScores, providers, purchases, settlements, shadowCalls, shadowChannels, signals } from "../db/schema.js";
import { env } from "../env.js";
import { badRequest, notFound } from "../lib/errors.js";
import { decodeCursor, encodeCursor } from "../lib/pagination.js";
import { PROBATION_N, publicProvider, publicSignal, scoreView } from "../lib/serialize.js";
import { INTERVALS, getCandles } from "../services/prices.js";
import type { AppEnv } from "../auth/context.js";
import { ErrorSchema, PageQuery, ProviderSchema, ScoreSchema, SignalDetailSchema, SignalSchema, page } from "./schemas.js";

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1")
  .optional();
const MAX_UPSTREAM_DEPTH = 3;

const json = <T extends z.ZodTypeAny>(schema: T, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const notFoundResp = json(ErrorSchema, "Not found");

// ───────────────────────── /stats ─────────────────────────

const StatsSchema = z
  .object({
    signalsCommitted: z.number().int(),
    signalsSettled: z.number().int(),
    paymentsSettled: z.number().int(),
    refundsPaid: z.string().openapi({ description: "USD" }),
    volumeUsd: z.string(),
    providers: z.number().int(),
  })
  .openapi("Stats");

const PAID = ["CREDITED", "KEY_SENT", "SETTLED_WIN", "REFUNDED"];

export async function stats() {
  const d = db();
  const [[sig], [settled], [pay], [refunds], [prov]] = await Promise.all([
    d.select({ n: count() }).from(signals),
    d.select({ n: count() }).from(signals).where(isNotNull(signals.outcome)),
    d
      .select({ n: count(), vol: sum(purchases.amount) })
      .from(purchases)
      .where(inArray(purchases.status, PAID)),
    d.select({ v: sum(settlements.refundsTotal) }).from(settlements),
    d.select({ n: count() }).from(providers),
  ]);
  return {
    signalsCommitted: sig?.n ?? 0,
    signalsSettled: settled?.n ?? 0,
    paymentsSettled: pay?.n ?? 0,
    refundsPaid: fromUnits(BigInt(refunds?.v ?? 0)),
    volumeUsd: fromUnits(BigInt(pay?.vol ?? 0)),
    providers: prov?.n ?? 0,
  };
}

// ───────────────────────── /providers ─────────────────────────

const SORTS = ["score", "wilson", "expectancy", "alpha", "n", "pnl", "newest"] as const;
const ProvidersQuery = PageQuery.extend({
  market: z.string().optional().openapi({ example: "BTC/USD" }),
  period: z.enum(["7d", "30d", "all"]).default("30d"),
  type: z.enum(["human", "agent", "aggregator"]).optional(),
  verified: bool,
  observed: bool.openapi({ description: "Include shadow profiles (observed, not committed)" }),
  sort: z.enum(SORTS).default("score"),
});
type ProvidersQuery = z.infer<typeof ProvidersQuery>;
type ProviderOut = z.infer<typeof ProviderSchema>;

function sortKey(p: ProviderOut, sort: (typeof SORTS)[number]): number {
  switch (sort) {
    case "wilson":
      return p.score.wilsonLb;
    case "expectancy":
      return p.score.expectancyR;
    case "alpha":
      return p.score.alphaBtc;
    case "n":
      return p.score.n;
    case "pnl":
      return p.score.followerPnl;
    case "newest":
      return Date.parse(p.createdAt);
    default:
      return p.score.score ?? -1;
  }
}

/** Shadow channels as observed profiles, scored from parsed public calls. */
async function observedProviders(): Promise<ProviderOut[]> {
  const rows = await db()
    .select({
      ch: shadowChannels,
      n: dsql<number>`count(${shadowCalls.id}) filter (where ${shadowCalls.outcome} in ('WIN','LOSS'))`.mapWith(Number),
      wins: dsql<number>`count(${shadowCalls.id}) filter (where ${shadowCalls.outcome} = 'WIN')`.mapWith(Number),
      avgR: dsql<string | null>`avg(${shadowCalls.rMultiple})`,
    })
    .from(shadowChannels)
    .leftJoin(shadowCalls, eq(shadowCalls.channelId, shadowChannels.id))
    .where(eq(shadowChannels.optedOut, false))
    .groupBy(shadowChannels.id);
  return rows.map(({ ch, n, wins, avgR }) => ({
    handle: `observed:${ch.username}`,
    displayName: ch.title ?? ch.username,
    bio: null,
    avatarUrl: null,
    address: "",
    erc8004Id: null,
    kind: "observed",
    verified: false,
    isPractice: false,
    observed: true,
    channelTitle: ch.title,
    defaultPriceUsd: "0",
    bondUsd: "0",
    createdAt: ch.createdAt.toISOString(),
    score: {
      ...scoreView(null),
      n,
      wins,
      losses: n - wins,
      winRate: n ? wins / n : 0,
      expectancyR: Number(avgR ?? 0),
      probation: n < PROBATION_N,
    },
  }));
}

export async function listProviders(q: ProvidersQuery) {
  if (q.market && !(q.market in MARKETS)) throw badRequest("bad_market", `Unknown market ${q.market}`);
  const conds = [];
  if (q.type) conds.push(eq(providers.kind, q.type));
  if (q.verified) conds.push(dsql`${providers.kycUntil} > now()`);
  const rows = await db()
    .select({ p: providers, s: providerScores })
    .from(providers)
    .leftJoin(
      providerScores,
      and(
        eq(providerScores.providerId, providers.id),
        eq(providerScores.period, q.period),
        eq(providerScores.market, q.market ?? "all"),
      ),
    )
    .where(conds.length ? and(...conds) : undefined);

  let all: ProviderOut[] = rows.map(({ p, s }) => publicProvider(p, s));
  if (q.observed && !q.type && !q.verified) all = all.concat(await observedProviders());

  // Ranked providers first, then by the chosen key, then handle for a stable order.
  all.sort(
    (a, b) =>
      Number(a.score.probation) - Number(b.score.probation) ||
      sortKey(b, q.sort) - sortKey(a, q.sort) ||
      a.handle.localeCompare(b.handle),
  );
  const offset = decodeCursor<{ o: number }>(q.cursor)?.o ?? 0;
  const items = all.slice(offset, offset + q.limit);
  const next = offset + q.limit < all.length ? encodeCursor({ o: offset + q.limit }) : null;
  return { items, nextCursor: next };
}

async function providerByHandle(handle: string) {
  const p = await db().query.providers.findFirst({ where: eq(providers.handle, handle) });
  if (!p) throw notFound("Provider");
  return p;
}

// ───────────────────────── /signals ─────────────────────────

const SignalsQuery = PageQuery.extend({
  status: z.string().optional().openapi({ example: "SETTLED" }),
  market: z.string().optional(),
  provider: z.string().optional().openapi({ description: "Provider handle" }),
});
type SignalsQuery = z.infer<typeof SignalsQuery>;

export async function listSignals(q: SignalsQuery, providerId?: number) {
  const conds = [];
  if (q.status) conds.push(inArray(signals.status, q.status.split(",").map((s) => s.trim().toUpperCase())));
  if (q.market) conds.push(eq(signals.market, q.market));
  if (providerId != null) conds.push(eq(signals.providerId, providerId));
  else if (q.provider) conds.push(eq(providers.handle, q.provider));
  const cur = decodeCursor<{ id: string }>(q.cursor);
  if (cur?.id) conds.push(lt(signals.id, BigInt(cur.id)));

  const rows = await db()
    .select({ s: signals, p: { handle: providers.handle, displayName: providers.displayName, kind: providers.kind } })
    .from(signals)
    .innerJoin(providers, eq(providers.id, signals.providerId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(signals.id))
    .limit(q.limit + 1);
  const hasMore = rows.length > q.limit;
  const items = rows.slice(0, q.limit).map(({ s, p }) => publicSignal(s, p));
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last ? encodeCursor({ id: last.id }) : null };
}

export async function signalDetail(id: bigint) {
  const row = await db()
    .select({ s: signals, p: { handle: providers.handle, displayName: providers.displayName, kind: providers.kind } })
    .from(signals)
    .innerJoin(providers, eq(providers.id, signals.providerId))
    .where(eq(signals.id, id));
  const first = row[0];
  if (!first) throw notFound("Signal");

  // Upstream tree (aggregator signals), breadth-first up to the on-chain max depth.
  const tree: { id: string; bps: number; depth: number; signal: ReturnType<typeof publicSignal> | null }[] = [];
  let frontier = first.s.upstreamJson.map((u) => ({ ...u, depth: 1 }));
  while (frontier.length) {
    const found = await db()
      .select({ s: signals, p: { handle: providers.handle, displayName: providers.displayName, kind: providers.kind } })
      .from(signals)
      .innerJoin(providers, eq(providers.id, signals.providerId))
      .where(inArray(signals.id, frontier.map((u) => BigInt(u.id))));
    const byId = new Map(found.map((f) => [f.s.id.toString(), f]));
    const next: typeof frontier = [];
    for (const u of frontier) {
      const f = byId.get(u.id);
      tree.push({ id: u.id, bps: u.bps, depth: u.depth, signal: f ? publicSignal(f.s, f.p) : null });
      if (f && u.depth < MAX_UPSTREAM_DEPTH) next.push(...f.s.upstreamJson.map((x) => ({ ...x, depth: u.depth + 1 })));
    }
    frontier = next;
  }

  const st = await db().query.settlements.findFirst({ where: eq(settlements.signalId, id) });
  return {
    ...publicSignal(first.s, first.p),
    upstreamTree: tree,
    settlement: st
      ? {
          outcome: st.outcome,
          proofTx: st.proofTx,
          settleTx: st.settleTx,
          payoutUsd: fromUnits(BigInt(st.payout)),
          refundsUsd: fromUnits(BigInt(st.refundsTotal)),
          slashUsd: fromUnits(BigInt(st.slashTotal)),
          settledAt: st.settledAt.toISOString(),
        }
      : null,
  };
}

// ───────────────────────── routes ─────────────────────────

const PricesQuery = z.object({
  market: z.string().default("BTC/USD"),
  interval: z.enum(INTERVALS).default("1h"),
  from: z.coerce.number().int().optional().openapi({ description: "ms since epoch" }),
  to: z.coerce.number().int().optional(),
});
const CandleSchema = z.object({ t: z.number(), o: z.string(), h: z.string(), l: z.string(), c: z.string(), v: z.string() });
const INTERVAL_DEFAULT_SPAN: Record<(typeof INTERVALS)[number], number> = {
  "1m": 6 * 3600_000,
  "5m": 24 * 3600_000,
  "15m": 3 * 86_400_000,
  "1h": 7 * 86_400_000,
  "4h": 30 * 86_400_000,
  "1d": 365 * 86_400_000,
};

const ContractsSchema = z
  .object({
    chainId: z.number().int(),
    deployed: z.boolean(),
    addresses: z.record(z.string(), z.unknown()),
    abis: z.record(z.string(), z.array(z.unknown())),
  })
  .openapi("Contracts");

const abiTable = {
  IdentityRegistry: abis.identityRegistryAbi,
  ReputationRegistry: abis.reputationRegistryAbi,
  ProviderRegistry: abis.providerRegistryAbi,
  SignalBook: abis.signalBookAbi,
  OutcomeResolver: abis.outcomeResolverAbi,
  PerformanceEscrow: abis.performanceEscrowAbi,
  RevenueRouter: abis.revenueRouterAbi,
  SignerCreditVerifier: abis.signerCreditVerifierAbi,
  ERC20: abis.erc20Abi,
} as Record<string, readonly unknown[]>;

export const publicRoutes = new OpenAPIHono<AppEnv>()
  .openapi(
    createRoute({
      method: "get",
      path: "/stats",
      tags: ["public"],
      responses: { 200: json(StatsSchema, "Totals for home and transparency") },
    }),
    async (c) => c.json(await stats(), 200),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/providers",
      tags: ["public"],
      request: { query: ProvidersQuery },
      responses: { 200: json(page(ProviderSchema), "Leaderboard") },
    }),
    async (c) => c.json(await listProviders(c.req.valid("query")), 200),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/providers/{handle}",
      tags: ["public"],
      request: { params: z.object({ handle: z.string() }) },
      responses: {
        200: json(ProviderSchema.extend({ scores: z.array(ScoreSchema.extend({ market: z.string() })) }), "Profile + scores"),
        404: notFoundResp,
      },
    }),
    async (c) => {
      const p = await providerByHandle(c.req.valid("param").handle);
      const scores = await db().query.providerScores.findMany({ where: eq(providerScores.providerId, p.id) });
      const main = scores.find((s) => s.period === "30d" && s.market === "all");
      return c.json(
        { ...publicProvider(p, main), scores: scores.map((s) => ({ ...scoreView(s), market: s.market })) },
        200,
      );
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/providers/{handle}/signals",
      tags: ["public"],
      request: { params: z.object({ handle: z.string() }), query: SignalsQuery.omit({ provider: true }) },
      responses: { 200: json(page(SignalSchema), "Signal history"), 404: notFoundResp },
    }),
    async (c) => {
      const p = await providerByHandle(c.req.valid("param").handle);
      return c.json(await listSignals(c.req.valid("query"), p.id), 200);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/signals",
      tags: ["public"],
      request: { query: SignalsQuery },
      responses: { 200: json(page(SignalSchema), "Signal feed (newest first)") },
    }),
    async (c) => c.json(await listSignals(c.req.valid("query")), 200),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/signals/{id}",
      tags: ["public"],
      request: { params: z.object({ id: z.string().regex(/^\d+$/) }) },
      responses: { 200: json(SignalDetailSchema, "Signal detail; plaintext only after reveal"), 404: notFoundResp },
    }),
    async (c) => c.json(await signalDetail(BigInt(c.req.valid("param").id)), 200),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/prices",
      tags: ["public"],
      request: { query: PricesQuery },
      responses: {
        200: json(z.object({ market: z.string(), interval: z.string(), candles: z.array(CandleSchema) }), "OHLC"),
        400: json(ErrorSchema, "Bad request"),
      },
    }),
    async (c) => {
      const q = c.req.valid("query");
      const to = q.to ?? Date.now();
      const from = q.from ?? to - INTERVAL_DEFAULT_SPAN[q.interval];
      const candles = await getCandles(q.market, q.interval, from, to);
      c.header("Cache-Control", "public, max-age=30");
      return c.json({ market: q.market, interval: q.interval, candles }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/contracts",
      tags: ["public"],
      responses: { 200: json(ContractsSchema, "Addresses + ABIs for the configured chain") },
    }),
    (c) => {
      const chainId = env().CHAIN_ID;
      c.header("Cache-Control", "public, max-age=300");
      return c.json(
        { chainId, deployed: isDeployed(chainId), addresses: deployment(chainId), abis: abiTable as Record<string, unknown[]> },
        200,
      );
    },
  );

