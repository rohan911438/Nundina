import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { z } from "zod";
import { fromUnits, generateEncryptionKey, toUnits } from "@nundina/shared";
import { db } from "../db/client.js";
import { agentActions, agents, type AgentPolicy } from "../db/schema.js";
import { getAuth, requireInternal, requireUser, type AppEnv, type Auth } from "../auth/context.js";
import { createApiKey } from "../auth/apiKey.js";
import { seal, unseal } from "../keys/masterKey.js";
import { badRequest, forbidden, notFound } from "../lib/errors.js";

const strip = (h: string) => (h.startsWith("0x") ? h.slice(2) : h);

/** Policy as the web form sends it: USD amounts as decimal strings. */
const PolicyBody = z.object({
  dailyBudgetUsd: z.string().regex(/^\d+(\.\d{1,6})?$/).optional(),
  maxPerSignalUsd: z.string().regex(/^\d+(\.\d{1,6})?$/).optional(),
  minScore: z.number().min(0).max(100).optional(),
  markets: z.array(z.string().min(3).max(20)).max(20).optional(),
  providersAllow: z.array(z.string().min(1).max(40)).max(50).optional(),
  providersDeny: z.array(z.string().min(1).max(40)).max(50).optional(),
  autoTrade: z.boolean().optional(),
  slippageBps: z.number().int().min(0).max(500).optional(),
});
const CreateBody = z.object({ name: z.string().min(1).max(60).default("Execution agent"), policy: PolicyBody.default({}) });
const ActivityBody = z.object({
  decision: z.enum(["buy", "skip", "post", "trade", "error"]),
  reason: z.string().max(2000).optional(),
  signalId: z.union([z.string().regex(/^\d+$/), z.number().int()]).optional(),
  purchaseId: z.uuid().optional(),
  fill: z.record(z.string(), z.unknown()).optional(),
});

function toPolicy(b: z.infer<typeof PolicyBody>, prev: AgentPolicy = {}): AgentPolicy {
  const { dailyBudgetUsd, maxPerSignalUsd, ...rest } = b;
  return {
    ...prev,
    ...rest,
    ...(dailyBudgetUsd != null ? { dailyBudget: toUnits(dailyBudgetUsd).toString() } : {}),
    ...(maxPerSignalUsd != null ? { maxPerSignal: toUnits(maxPerSignalUsd).toString() } : {}),
  };
}

type AgentRow = typeof agents.$inferSelect;

export function agentView(a: AgentRow) {
  const p = a.policyJson ?? {};
  return {
    id: a.id,
    name: a.name,
    type: a.type,
    wallet: a.wallet,
    paused: a.paused,
    policy: {
      dailyBudgetUsd: p.dailyBudget ? fromUnits(BigInt(p.dailyBudget)) : null,
      maxPerSignalUsd: p.maxPerSignal ? fromUnits(BigInt(p.maxPerSignal)) : null,
      minScore: p.minScore ?? null,
      markets: p.markets ?? [],
      providersAllow: p.providersAllow ?? [],
      providersDeny: p.providersDeny ?? [],
      autoTrade: p.autoTrade ?? false,
      slippageBps: p.slippageBps ?? 50,
    },
    spentTodayUsd: fromUnits(BigInt(a.spentToday)),
    createdAt: a.createdAt.toISOString(),
  };
}

/** Owner (session) or the agent itself (its API key) may act on an agent. */
async function ownAgent(id: string, a: Auth) {
  const n = Number(id);
  if (!Number.isInteger(n)) throw notFound("Agent");
  const ag = await db().query.agents.findFirst({ where: eq(agents.id, n) });
  if (!ag) throw notFound("Agent");
  if (a.kind === "internal") return ag;
  if (a.agentId != null ? a.agentId !== ag.id : ag.ownerUserId !== a.userId) throw forbidden("Not your agent");
  return ag;
}

export const agentRoutes = new Hono<AppEnv>()
  /** Creates an execution agent with its own wallet and encryption key. The API key is shown once. */
  .post("/agents", requireUser, async (c) => {
    const a = getAuth(c);
    if (a.agentId) throw forbidden("Agents cannot create agents");
    const body = CreateBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw badRequest("bad_body", body.error.issues.map((i) => i.message).join("; "));
    const pk = generatePrivateKey();
    const wallet = privateKeyToAccount(pk).address;
    const enc = generateEncryptionKey();
    const [ag] = await db()
      .insert(agents)
      .values({
        ownerUserId: a.userId,
        name: body.data.name,
        type: "execution",
        wallet: wallet.toLowerCase(),
        walletKeyEnc: seal(hexToBytes(strip(pk))),
        encKeyEnc: seal(hexToBytes(strip(enc.privateKey))),
        encPubkey: enc.publicKey.toLowerCase(),
        policyJson: toPolicy(body.data.policy),
      })
      .returning();
    const apiKey = await createApiKey({ ownerUserId: a.userId, agentId: ag!.id, label: `agent:${ag!.id}` });
    return c.json({ agent: agentView(ag!), apiKey }, 201);
  })
  .get("/agents", requireUser, async (c) => {
    const a = getAuth(c);
    const where = a.agentId ? eq(agents.id, a.agentId) : eq(agents.ownerUserId, a.userId!);
    const rows = await db().select().from(agents).where(where).orderBy(desc(agents.id));
    return c.json({ items: rows.map(agentView) });
  })
  .get("/agents/:id", requireUser, async (c) => c.json(agentView(await ownAgent(c.req.param("id"), getAuth(c)))))
  .patch("/agents/:id/policy", requireUser, async (c) => {
    const ag = await ownAgent(c.req.param("id"), getAuth(c));
    if (getAuth(c).agentId) throw forbidden("Only the owner can change the policy");
    const body = PolicyBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw badRequest("bad_policy", body.error.issues.map((i) => i.message).join("; "));
    const [u] = await db()
      .update(agents)
      .set({ policyJson: toPolicy(body.data, ag.policyJson) })
      .where(eq(agents.id, ag.id))
      .returning();
    return c.json(agentView(u!));
  })
  /** Kill switch. `{ paused: false }` resumes. */
  .post("/agents/:id/pause", requireUser, async (c) => {
    const ag = await ownAgent(c.req.param("id"), getAuth(c));
    const body = (await c.req.json().catch(() => ({}))) as { paused?: unknown };
    const paused = body.paused === undefined ? true : body.paused === true;
    if (!paused && getAuth(c).agentId) throw forbidden("Only the owner can resume");
    const [u] = await db().update(agents).set({ paused }).where(eq(agents.id, ag.id)).returning();
    return c.json(agentView(u!));
  })
  .get("/agents/:id/activity", requireUser, async (c) => {
    const ag = await ownAgent(c.req.param("id"), getAuth(c));
    const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 200);
    const rows = await db()
      .select()
      .from(agentActions)
      .where(eq(agentActions.agentId, ag.id))
      .orderBy(desc(agentActions.createdAt), desc(agentActions.id))
      .limit(limit);
    return c.json({
      items: rows.map((r) => ({
        id: r.id,
        decision: r.decision,
        reason: r.reason,
        signalId: r.signalId?.toString() ?? null,
        purchaseId: r.purchaseId,
        fill: r.fillJson,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  })
  /** The agent process logs every decision here (its own API key). */
  .post("/agents/:id/activity", requireUser, async (c) => {
    const ag = await ownAgent(c.req.param("id"), getAuth(c));
    const body = ActivityBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw badRequest("bad_body", body.error.issues.map((i) => i.message).join("; "));
    const b = body.data;
    const [row] = await db()
      .insert(agentActions)
      .values({
        agentId: ag.id,
        decision: b.decision,
        reason: b.reason,
        signalId: b.signalId != null ? BigInt(b.signalId) : null,
        purchaseId: b.purchaseId,
        fillJson: b.fill,
      })
      .returning({ id: agentActions.id });
    return c.json({ id: row!.id }, 201);
  })
  /** Agent runtime (prompt 13) loads its keys over the internal channel; never exposed to users. */
  .get("/internal/agents/:id/secrets", requireInternal, async (c) => {
    const ag = await ownAgent(c.req.param("id"), getAuth(c));
    return c.json({
      id: ag.id,
      wallet: ag.wallet,
      walletKey: ag.walletKeyEnc ? `0x${bytesToHex(unseal(ag.walletKeyEnc))}` : null,
      encKey: ag.encKeyEnc ? `0x${bytesToHex(unseal(ag.encKeyEnc))}` : null,
    });
  })
  .get("/internal/agents", requireInternal, async (c) => {
    const type = c.req.query("type") ?? "execution";
    const rows = await db()
      .select()
      .from(agents)
      .where(and(eq(agents.type, type), eq(agents.paused, false)));
    return c.json({ items: rows.map((r) => ({ ...agentView(r), ownerUserId: r.ownerUserId })) });
  });
