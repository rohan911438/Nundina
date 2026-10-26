import { z } from "@hono/zod-openapi";

/** OpenAPI response schemas; they mirror `lib/serialize.ts`. */

export const ErrorSchema = z
  .object({ error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }) })
  .openapi("Error");

export const ScoreSchema = z
  .object({
    period: z.string().nullable(),
    n: z.number().int(),
    wins: z.number().int(),
    losses: z.number().int(),
    voids: z.number().int(),
    winRate: z.number(),
    wilsonLb: z.number(),
    expectancyR: z.number(),
    alphaBtc: z.number(),
    maxDd: z.number(),
    followerPnl: z.number(),
    score: z.number(),
    probation: z.boolean().openapi({ description: "true while n < 30 settled signals" }),
  })
  .openapi("Score");

export const ProviderSchema = z
  .object({
    handle: z.string(),
    displayName: z.string(),
    bio: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    address: z.string(),
    erc8004Id: z.string().nullable(),
    kind: z.string().openapi({ example: "human" }),
    verified: z.boolean(),
    isPractice: z.boolean(),
    observed: z.boolean().openapi({ description: "Shadow profile scored from a public channel, not committed" }),
    channelTitle: z.string().nullable(),
    defaultPriceUsd: z.string(),
    bondUsd: z.string(),
    createdAt: z.string(),
    score: ScoreSchema,
  })
  .openapi("Provider");

export const SignalSchema = z
  .object({
    id: z.string(),
    provider: z.object({ handle: z.string(), displayName: z.string(), kind: z.string() }).nullable(),
    commitHash: z.string(),
    market: z.string(),
    status: z.string(),
    outcome: z.string().nullable(),
    rMultiple: z.number().nullable(),
    revealed: z.boolean(),
    side: z.enum(["LONG", "SHORT"]).nullable(),
    entry: z.string().nullable(),
    takeProfit: z.string().nullable(),
    stopLoss: z.string().nullable(),
    isLimit: z.boolean().nullable(),
    oraclePriceAtCommit: z.string().nullable(),
    priceUsd: z.string(),
    validUntil: z.string(),
    committedAt: z.string(),
    revealedAt: z.string().nullable(),
    decidedAt: z.string().nullable(),
    purchaseCount: z.number().int(),
    upstream: z.array(z.object({ id: z.string(), bps: z.number() })),
    tx: z.object({ commit: z.string().nullable(), reveal: z.string().nullable(), resolve: z.string().nullable() }),
  })
  .openapi("Signal");

export const SignalDetailSchema = SignalSchema.extend({
  upstreamTree: z.array(
    z.object({ id: z.string(), bps: z.number(), depth: z.number().int(), signal: SignalSchema.nullable() }),
  ),
  settlement: z
    .object({
      outcome: z.string(),
      proofTx: z.string().nullable(),
      settleTx: z.string().nullable(),
      payoutUsd: z.string(),
      refundsUsd: z.string(),
      slashUsd: z.string(),
      settledAt: z.string(),
    })
    .nullable(),
}).openapi("SignalDetail");

export const page = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

export const PageQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
