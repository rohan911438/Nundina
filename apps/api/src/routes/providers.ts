import { Hono } from "hono";
import { and, count, desc, eq, gt, isNull, sql as dsql } from "drizzle-orm";
import { encodeFunctionData, getAddress, isAddress, keccak256, toBytes, type Address } from "viem";
import { z } from "zod";
import { fromUnits, toUnits } from "@nundina/shared";
import { identityRegistryAbi } from "@nundina/shared/abis";
import { db } from "../db/client.js";
import { providerScores, providers, signalDrafts, signals, telegramLinkCodes } from "../db/schema.js";
import { env } from "../env.js";
import { getAuth, requireInternal, requireUser, type AppEnv } from "../auth/context.js";
import { addr } from "../chain/clients.js";
import { badRequest, conflict, notFound, unauthorized } from "../lib/errors.js";
import { bytesToHex, randomBytes } from "../lib/crypto.js";
import { publicProvider, publicSignal, scoreView } from "../lib/serialize.js";

const LINK_CODE_TTL_MS = 15 * 60 * 1000;

const RegisterBody = z.object({
  handle: z
    .string()
    .regex(/^[a-z0-9_]{3,32}$/, "3-32 chars: a-z, 0-9, _")
    .transform((s) => s.toLowerCase()),
  displayName: z.string().min(1).max(64),
  bio: z.string().max(280).optional(),
  payoutAddr: z.string().refine(isAddress, "invalid address").optional(),
  kind: z.enum(["human", "agent", "aggregator"]).default("human"),
  practice: z.boolean().default(false),
  defaultPrice: z.string().regex(/^\d+(\.\d{1,6})?$/).default("1"),
  telegramHandle: z.string().optional(),
});

const LinkBody = z.object({
  code: z.string().min(6),
  channelId: z.number().int(),
  channelTitle: z.string().optional(),
});

/** The provider row of the signed-in user, or 404. */
export async function myProvider(userId: number | undefined) {
  if (!userId) throw unauthorized();
  const p = await db().query.providers.findFirst({ where: eq(providers.userId, userId) });
  if (!p) throw notFound("Provider profile");
  return p;
}

/** Calldata the provider wallet signs to register on-chain (ERC-8004 identity, then ProviderRegistry). */
function registrationTxs(handle: string, payout: Address, practice: boolean, tgHandle?: string) {
  const agentUri = `${env().PUBLIC_API_URL}/providers/${handle}/agent.json`;
  const tgHash = keccak256(toBytes(tgHandle ?? `@${handle}`));
  let identity: Address | null = null;
  let registry: Address | null = null;
  try {
    identity = addr("IdentityRegistry");
    registry = addr("ProviderRegistry");
  } catch {
    /* not deployed on this chain yet */
  }
  return {
    chainId: env().CHAIN_ID,
    steps: [
      {
        label: "Create ERC-8004 identity",
        to: identity,
        data: encodeFunctionData({ abi: identityRegistryAbi, functionName: "register", args: [agentUri] }),
      },
      {
        label: "Register as provider",
        to: registry,
        /** `agentId` comes from the Registered event of step 1; the client fills it in. */
        abi: "register(uint256 agentId,address payout,bytes32 tgHandleHash,bool practice)",
        args: { payout, tgHandleHash: tgHash, practice },
      },
    ],
  };
}

export const providerRoutes = new Hono<AppEnv>()
  .post("/providers/register", requireUser, async (c) => {
    const a = getAuth(c);
    if (!a.wallet) throw badRequest("wallet_required", "Connect a wallet first");
    const body = RegisterBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw badRequest("bad_body", body.error.issues.map((i) => i.message).join("; "));
    const b = body.data;
    const existing = await db().query.providers.findFirst({ where: eq(providers.userId, a.userId!) });
    if (existing) throw conflict("already_registered", "You already have a provider profile");
    const taken = await db().query.providers.findFirst({ where: eq(providers.handle, b.handle) });
    if (taken) throw conflict("handle_taken", "Handle is taken");

    const address = getAddress(a.wallet);
    const payout = getAddress(b.payoutAddr ?? address);
    const [p] = await db()
      .insert(providers)
      .values({
        userId: a.userId,
        handle: b.handle,
        displayName: b.displayName,
        bio: b.bio,
        address: address.toLowerCase(),
        payoutAddr: payout.toLowerCase(),
        kind: b.kind,
        isAgent: b.kind !== "human",
        isPractice: b.practice,
        defaultPrice: b.practice ? "0" : toUnits(b.defaultPrice).toString(),
      })
      .returning();
    return c.json(
      {
        provider: publicProvider(p!),
        tx: registrationTxs(b.handle, payout, b.practice, b.telegramHandle),
      },
      201,
    );
  })
  /** Provider asks for a one-time code, then sends `/link <code>` in their channel; the bot calls the route below. */
  .post("/providers/link-telegram/code", requireUser, async (c) => {
    const p = await myProvider(getAuth(c).userId);
    const code = bytesToHex(randomBytes(4)).toUpperCase();
    await db()
      .insert(telegramLinkCodes)
      .values({ code, providerId: p.id, expiresAt: new Date(Date.now() + LINK_CODE_TTL_MS) });
    return c.json({ code, expiresInS: LINK_CODE_TTL_MS / 1000 });
  })
  .post("/providers/link-telegram", requireInternal, async (c) => {
    const body = LinkBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw badRequest("bad_body", "code and channelId required");
    const { code, channelId, channelTitle } = body.data;
    const [used] = await db()
      .update(telegramLinkCodes)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(telegramLinkCodes.code, code.toUpperCase()),
          isNull(telegramLinkCodes.usedAt),
          gt(telegramLinkCodes.expiresAt, new Date()),
        ),
      )
      .returning();
    if (!used) throw badRequest("bad_code", "Code invalid or expired");
    const [p] = await db()
      .update(providers)
      .set({ channelId, channelTitle })
      .where(eq(providers.id, used.providerId))
      .returning();
    return c.json({ provider: publicProvider(p!) });
  })
  .get("/me/provider", requireUser, async (c) => {
    const p = await myProvider(getAuth(c).userId);
    const [scores, recent, drafts, [counts]] = await Promise.all([
      db().query.providerScores.findMany({ where: eq(providerScores.providerId, p.id) }),
      db().select().from(signals).where(eq(signals.providerId, p.id)).orderBy(desc(signals.id)).limit(20),
      db()
        .select()
        .from(signalDrafts)
        .where(and(eq(signalDrafts.providerId, p.id), dsql`${signalDrafts.status} in ('pending','prepared')`))
        .orderBy(desc(signalDrafts.id))
        .limit(20),
      db()
        .select({
          live: dsql<number>`count(*) filter (where ${signals.outcome} is null)`.mapWith(Number),
          sales: dsql<number>`coalesce(sum(${signals.purchaseCount}),0)`.mapWith(Number),
          total: count(),
        })
        .from(signals)
        .where(eq(signals.providerId, p.id)),
    ]);
    const main = scores.find((s) => s.period === "30d" && s.market === "all");
    return c.json({
      provider: { ...publicProvider(p, main), payoutAddr: p.payoutAddr, channelId: p.channelId, linked: p.channelId != null },
      scores: scores.map((s) => ({ ...scoreView(s), market: s.market })),
      counts: counts ?? { live: 0, sales: 0, total: 0 },
      bond: { totalUsd: fromUnits(BigInt(p.bondTotal)), lockedUsd: fromUnits(BigInt(p.bondLocked)) },
      recentSignals: recent.map((s) => publicSignal(s, p)),
      drafts: drafts.map((d) => ({
        id: d.id,
        rawText: d.rawText,
        parsed: d.parsedJson,
        parser: d.parser,
        status: d.status,
        createdAt: d.createdAt.toISOString(),
      })),
    });
  });
