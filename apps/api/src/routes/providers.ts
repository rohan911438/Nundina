import { Hono } from "hono";
import { and, count, desc, eq, gt, isNull, sql as dsql } from "drizzle-orm";
import { encodeFunctionData, getAddress, isAddress, keccak256, toBytes, type Address } from "viem";
import { z } from "zod";
import { fromUnits, toUnits } from "@nundina/shared";
import { identityRegistryAbi } from "@nundina/shared/abis";
import { db } from "../db/client.js";
import { providerScores, providers, settlements, signalDrafts, signals, telegramLinkCodes } from "../db/schema.js";
import { env } from "../env.js";
import { getAuth, requireInternal, requireUser, type AppEnv } from "../auth/context.js";
import { addr } from "../chain/clients.js";
import { badRequest, conflict, notFound, unauthorized } from "../lib/errors.js";
import { bytesToHex, randomBytes } from "../lib/crypto.js";
import { PROBATION_N, publicProvider, publicSignal, scoreView } from "../lib/serialize.js";
import { verifyChannel } from "../services/channelVerify.js";
import { providerOfUser } from "../services/providerOfUser.js";
import { redeemOnWeb, startLinkFromWeb } from "../services/telegramAccount.js";

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

const SettingsBody = z.object({
  defaultPrice: z.string().regex(/^\d+(\.\d{1,6})?$/).optional(),
  defaultValidityHours: z.number().int().min(1).max(168).optional(),
  payIfWorks: z.boolean().optional(),
  practice: z.boolean().optional(),
});

export const ChannelFactsBody = z.object({
  channelId: z.number().int(),
  title: z.string().default(""),
  username: z.string().nullish(),
  members: z.number().int().nullish(),
  admins: z.array(z.object({ id: z.number().int(), status: z.enum(["creator", "administrator"]) })),
});
const LinkBody = ChannelFactsBody.extend({ code: z.string().min(6) });

/** The provider row of the signed-in user (claiming the indexer's row for their wallet), or 404. */
export async function myProvider(auth: { userId?: number; wallet?: string | null }) {
  if (!auth.userId) throw unauthorized();
  const p = await providerOfUser(auth.userId, auth.wallet);
  if (!p) throw notFound("Provider profile");
  return p;
}

/** Calldata the provider wallet signs to register on-chain (ERC-8004 identity, then ProviderRegistry). */
function registrationTxs(handle: string, payout: Address, practice: boolean, tgHandle?: string) {
  // ERC-8004 agent card, served by the web app (apps/web/app/api/agent-card)
  const agentUri = `${env().WEB_ORIGIN.split(",")[0]!.trim()}/api/agent-card/${handle}`;
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
    // registered on-chain before this profile existed: the indexer's row for the address becomes it
    const unclaimed = await db().query.providers.findFirst({ where: and(eq(providers.address, address.toLowerCase()), isNull(providers.userId)) });
    if (unclaimed) {
      const [p] = await db()
        .update(providers)
        .set({
          userId: a.userId,
          handle: b.handle,
          displayName: b.displayName,
          bio: b.bio,
          kind: b.kind,
          isAgent: b.kind !== "human",
          isPractice: b.practice,
          defaultPrice: b.practice ? "0" : toUnits(b.defaultPrice).toString(),
        })
        .where(eq(providers.id, unclaimed.id))
        .returning();
      return c.json({ provider: publicProvider(p!), tx: registrationTxs(b.handle, payout, b.practice, b.telegramHandle) }, 201);
    }
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
    const p = await myProvider(getAuth(c));
    const code = bytesToHex(randomBytes(4)).toUpperCase();
    await db()
      .insert(telegramLinkCodes)
      .values({ code, providerId: p.id, expiresAt: new Date(Date.now() + LINK_CODE_TTL_MS) });
    return c.json({ code, expiresInS: LINK_CODE_TTL_MS / 1000 });
  })
  .post("/providers/link-telegram", requireInternal, async (c) => {
    const body = LinkBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw badRequest("bad_body", "code, channelId and admins required");
    const { code, ...facts } = body.data;
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
    // the code says which profile; ownership still has to come from Telegram's admin list
    const r = await verifyChannel(used.providerId, facts);
    return c.json({ provider: publicProvider(r.provider), role: r.role, lookalikeOf: r.lookalikeOf, telegramId: r.telegramId });
  })
  /** Web starts a Telegram account link: open t.me/<bot>?start=acct_<token> and the bot finishes it. */
  .post("/me/telegram/link", requireUser, async (c) => {
    const a = getAuth(c);
    if (!a.wallet) throw badRequest("wallet_required", "Sign in with your wallet first");
    return c.json(await startLinkFromWeb(a.userId!));
  })
  /** Web finishes a link the bot started with /connect. */
  .post("/me/telegram/redeem", requireUser, async (c) => {
    const a = getAuth(c);
    if (!a.wallet) throw badRequest("wallet_required", "Sign in with your wallet first");
    const b = z.object({ token: z.string().min(8) }).safeParse(await c.req.json().catch(() => ({})));
    if (!b.success) throw badRequest("bad_body", "token required");
    return c.json(await redeemOnWeb(b.data.token, a.userId!));
  })
  .get("/me/provider", requireUser, async (c) => {
    const p = await myProvider(getAuth(c));
    const [scores, recent, drafts, [counts], payouts] = await Promise.all([
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
      db()
        .select({ s: settlements })
        .from(settlements)
        .innerJoin(signals, eq(signals.id, settlements.signalId))
        .where(eq(signals.providerId, p.id))
        .orderBy(desc(settlements.settledAt))
        .limit(200),
    ]);
    let net = 0n;
    let fees = 0n;
    let slashed = 0n;
    for (const { s } of payouts) {
      net += BigInt(s.payout);
      fees += BigInt(s.fee);
      slashed += BigInt(s.slashTotal);
    }
    const main = scores.find((s) => s.period === "30d" && s.market === "all");
    return c.json({
      provider: { ...publicProvider(p, main), payoutAddr: p.payoutAddr, channelId: p.channelId, linked: p.channelId != null },
      settings: {
        defaultPriceUsd: fromUnits(BigInt(p.defaultPrice)),
        defaultValidityHours: p.defaultValidityHours,
        practice: p.isPractice,
        payIfWorks: p.payIfWorks,
        // pay-if-works unlocks after probation (30 settled signals)
        payIfWorksAllowed: (main?.n ?? 0) >= PROBATION_N,
      },
      scores: scores.map((s) => ({ ...scoreView(s), market: s.market })),
      counts: counts ?? { live: 0, sales: 0, total: 0 },
      bond: { totalUsd: fromUnits(BigInt(p.bondTotal)), lockedUsd: fromUnits(BigInt(p.bondLocked)) },
      // payout is net of the fee; gross = payout + fee
      earnings: { grossUsd: fromUnits(net + fees), feesUsd: fromUnits(fees), slashedUsd: fromUnits(slashed), netUsd: fromUnits(net - slashed) },
      payouts: payouts.slice(0, 20).map(({ s }) => ({
        signalId: s.signalId.toString(),
        outcome: s.outcome,
        payoutUsd: fromUnits(BigInt(s.payout)),
        slashUsd: fromUnits(BigInt(s.slashTotal)),
        settleTx: s.settleTx,
        settledAt: s.settledAt.toISOString(),
      })),
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
  })
  .patch("/me/provider", requireUser, async (c) => {
    const p = await myProvider(getAuth(c));
    const body = SettingsBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw badRequest("bad_body", body.error.issues.map((i) => i.message).join("; "));
    const b = body.data;
    if (b.payIfWorks) {
      const main = await db().query.providerScores.findFirst({
        where: and(eq(providerScores.providerId, p.id), eq(providerScores.period, "30d"), eq(providerScores.market, "all")),
      });
      if ((main?.n ?? 0) < PROBATION_N) throw conflict("probation", `Pay-if-works unlocks after ${PROBATION_N} settled signals`);
    }
    // practice can only be left (on-chain `leavePractice` is one-way), never re-entered
    if (b.practice === true && !p.isPractice) throw conflict("practice_one_way", "A provider cannot go back to practice");
    const [u] = await db()
      .update(providers)
      .set({
        ...(b.defaultPrice != null ? { defaultPrice: toUnits(b.defaultPrice).toString() } : {}),
        ...(b.defaultValidityHours != null ? { defaultValidityHours: b.defaultValidityHours } : {}),
        ...(b.payIfWorks != null ? { payIfWorks: b.payIfWorks } : {}),
        ...(b.practice === false ? { isPractice: false } : {}),
      })
      .where(eq(providers.id, p.id))
      .returning();
    return c.json({
      defaultPriceUsd: fromUnits(BigInt(u!.defaultPrice)),
      defaultValidityHours: u!.defaultValidityHours,
      practice: u!.isPractice,
      payIfWorks: u!.payIfWorks,
    });
  });
