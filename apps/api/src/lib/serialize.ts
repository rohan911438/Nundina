import { MARKETS, Side, fromPrice, fromUnits } from "@nundina/shared";
import type { providers, providerScores, signals } from "../db/schema.js";

type SignalRow = typeof signals.$inferSelect;
type ProviderRow = typeof providers.$inferSelect;
type ScoreRow = typeof providerScores.$inferSelect;

export const PROBATION_N = 30;
/** Plaintext is public only after reveal (resolution doubles as reveal). */
const PUBLIC_STATUSES = new Set(["REVEALED", "RESOLVED", "SETTLED", "REFUNDED"]);

export function isPlaintextPublic(s: Pick<SignalRow, "status" | "revealedAt">): boolean {
  return s.revealedAt != null || PUBLIC_STATUSES.has(s.status);
}

const price = (v: string | null, market: string) => {
  if (v == null) return null;
  const dp = MARKETS[market as keyof typeof MARKETS]?.displayDecimals ?? 8;
  return Number(fromPrice(BigInt(v))).toFixed(dp);
};

/**
 * Public view of a signal. Never includes ciphertext, keys or salt, and nulls every plaintext
 * field until the signal is revealed.
 */
export function publicSignal(s: SignalRow, provider?: Pick<ProviderRow, "handle" | "displayName" | "kind"> | null) {
  const open = isPlaintextPublic(s);
  return {
    id: s.id.toString(),
    provider: provider ? { handle: provider.handle, displayName: provider.displayName, kind: provider.kind } : null,
    commitHash: s.commitHash,
    market: s.market,
    status: s.status,
    outcome: s.outcome,
    rMultiple: s.rMultiple == null ? null : Number(s.rMultiple),
    revealed: open,
    side: open && s.side != null ? (s.side === Side.LONG ? ("LONG" as const) : ("SHORT" as const)) : null,
    entry: open ? price(s.entry, s.market) : null,
    takeProfit: open ? price(s.tp, s.market) : null,
    stopLoss: open ? price(s.sl, s.market) : null,
    isLimit: open ? s.isLimit : null,
    oraclePriceAtCommit: price(s.oraclePrice, s.market),
    priceUsd: fromUnits(BigInt(s.price)),
    validUntil: s.validUntil.toISOString(),
    committedAt: s.committedAt.toISOString(),
    revealedAt: s.revealedAt?.toISOString() ?? null,
    decidedAt: s.decidedAt?.toISOString() ?? null,
    purchaseCount: s.purchaseCount,
    upstream: s.upstreamJson,
    tx: { commit: s.commitTx, reveal: s.revealTx, resolve: s.resolveTx },
  };
}
export type PublicSignal = ReturnType<typeof publicSignal>;

export function scoreView(s: ScoreRow | null | undefined) {
  const n = s?.n ?? 0;
  return {
    period: s?.period ?? null,
    n,
    wins: s?.wins ?? 0,
    losses: s?.losses ?? 0,
    voids: s?.voids ?? 0,
    winRate: Number(s?.winRate ?? 0),
    wilsonLb: Number(s?.wilsonLb ?? 0),
    expectancyR: Number(s?.expectancyR ?? 0),
    alphaBtc: Number(s?.alphaBtc ?? 0),
    maxDd: Number(s?.maxDd ?? 0),
    followerPnl: Number(s?.followerPnl ?? 0),
    /** No score while on probation (n < 30). */
    score: n < PROBATION_N ? null : Number(s?.score ?? 0),
    probation: n < PROBATION_N,
  };
}

export function publicProvider(p: ProviderRow, score?: ScoreRow | null) {
  return {
    handle: p.handle,
    displayName: p.displayName,
    bio: p.bio,
    avatarUrl: p.avatarUrl,
    address: p.address,
    erc8004Id: p.erc8004Id,
    kind: p.kind,
    verified: p.kycUntil != null && p.kycUntil > new Date(),
    isPractice: p.isPractice,
    observed: false,
    channelTitle: p.channelTitle,
    defaultPriceUsd: fromUnits(BigInt(p.defaultPrice)),
    bondUsd: fromUnits(BigInt(p.bondTotal)),
    createdAt: p.createdAt.toISOString(),
    score: scoreView(score),
  };
}
