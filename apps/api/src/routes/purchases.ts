import { Hono } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";
import { encodeAbiParameters, encodeFunctionData, getAddress, isAddress, keccak256, parseSignature, type Address, type Hex } from "viem";
import { z } from "zod";
import { fromUnits, isEncryptionPublicKey, paymentToken, serializeSignal, usdcE } from "@nundina/shared";
import { performanceEscrowAbi, providerRegistryAbi } from "@nundina/shared/abis";
import { db } from "../db/client.js";
import { agents, keyDeliveries, providers, purchases, signals, users } from "../db/schema.js";
import { env } from "../env.js";
import { getAuth, requireInternal, requireUser, type AppEnv, type Auth } from "../auth/context.js";
import { addr, publicClient } from "../chain/clients.js";
import { relay } from "../chain/relayer.js";
import { ApiError, badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { publicSignal } from "../lib/serialize.js";
import { revealMaterial, splitCiphertext, wrapKeyFor } from "../keys/keyService.js";
import { paymentRail } from "../payments/index.js";
import { explorerTxUrl } from "../payments/DirectRail.js";
import { syncGatewayPurchase } from "../payments/gatewaySync.js";
import { enqueue, JOBS } from "../jobs/queue.js";
import { revealSignal } from "../jobs/reveal.js";

const NO_KEY = "This signal can't be unlocked: its key was not saved when it was locked. Pick another signal; the provider can post it again.";
const OPEN_STATUSES = ["COMMITTED", "REVEALED"];
const PAID_STATUSES = ["CREDITED", "KEY_SENT", "SETTLED_WIN", "REFUNDED"];
/** Statuses after which a buyer may start a fresh attempt for the same signal. */
const RETRYABLE_STATUSES = ["REJECTED", "FAILED_RETRYABLE"];
/** Fallback if the escrow can't be read; the on-chain cap (`maxSubscribers`, 50 on mainnet) wins. */
const MAX_SUBSCRIBERS = 200;

async function subscriberCap(): Promise<number> {
  const cap = await publicClient()
    .readContract({ address: addr("PerformanceEscrow"), abi: performanceEscrowAbi, functionName: "maxSubscribers" })
    .catch(() => BigInt(MAX_SUBSCRIBERS));
  return Number(cap);
}

const CreateBody = z.object({
  signalId: z.union([z.string().regex(/^\d+$/), z.number().int().positive()]).transform((v) => BigInt(v)),
  token: z.enum(["USDT", "USDC_E"]).default("USDT"),
  compliance: z.array(z.enum(["kyc", "sanctions"])).optional(),
});
const SubmitBody = z.object({
  mandateSig: z.string().regex(/^0x[0-9a-fA-F]+$/),
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});
const AuthorizeBody = z.object({
  authorization: z.object({
    from: z.string().refine(isAddress),
    to: z.string().refine(isAddress),
    value: z.union([z.string().regex(/^\d+$/), z.number()]).transform((v) => BigInt(v)),
    validAfter: z.union([z.string().regex(/^\d+$/), z.number()]).transform((v) => BigInt(v)),
    validBefore: z.union([z.string().regex(/^\d+$/), z.number()]).transform((v) => BigInt(v)),
    nonce: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  }),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
});
const KeyBody = z.object({ publicKey: z.string().refine(isEncryptionPublicKey, "not a secp256k1 public key") });

/** Wallet that pays: the agent's wallet for agent API keys, else the signed-in wallet. */
async function payerOf(a: Auth): Promise<Address> {
  if (a.agentId) {
    const ag = await db().query.agents.findFirst({ where: eq(agents.id, a.agentId) });
    if (ag?.wallet) return getAddress(ag.wallet);
  }
  if (!a.wallet) throw badRequest("wallet_required", "Link a wallet to buy signals");
  return getAddress(a.wallet);
}

/** The token a signal is already being paid in: on-chain once credited, else any purchase in flight. */
async function potToken(signalId: bigint, ignorePurchaseId?: string): Promise<Address | null> {
  const pot = await publicClient()
    .readContract({ address: addr("PerformanceEscrow"), abi: performanceEscrowAbi, functionName: "potOf", args: [signalId] })
    .catch(() => null);
  if (pot && pot.token !== "0x0000000000000000000000000000000000000000") return getAddress(pot.token);
  const inflight = await db().query.purchases.findMany({
    where: and(eq(purchases.signalId, signalId), inArray(purchases.status, ["SUBMITTED", "FAILED_RETRYABLE", ...PAID_STATUSES])),
  });
  const other = inflight.find((p) => p.id !== ignorePurchaseId);
  return other ? getAddress(other.token) : null;
}

async function ownPurchase(id: string, a: Auth) {
  if (!z.uuid().safeParse(id).success) throw notFound("Purchase");
  const p = await db().query.purchases.findFirst({ where: eq(purchases.id, id) });
  if (!p) throw notFound("Purchase");
  if (a.kind === "internal" && !a.userId) return p;
  if (!a.userId || p.buyerUserId !== a.userId) throw forbidden("Not your purchase");
  return p;
}

function purchaseView(p: typeof purchases.$inferSelect) {
  return {
    id: p.id,
    signalId: p.signalId.toString(),
    status: p.status,
    amount: p.amount,
    amountUsd: fromUnits(BigInt(p.amount)),
    token: p.token,
    rail: p.rail,
    paymentId: p.hspPaymentId,
    /** HSP gateway checkout (live rail): open it to authorise the payment. */
    paymentUrl: (p.mandateJson as { paymentUrl?: string } | null)?.paymentUrl ?? null,
    txHash: p.txHash,
    outcomeClass: p.outcomeClass,
    receiptHash: p.receiptHash,
    creditedTx: p.creditedTx,
    explorerUrl: p.explorerUrl,
    recoveryTx: p.recoveryTx,
    rejectReason: p.rejectReason,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

/** Deliver the key after an on-chain credit (both rails). */
async function afterCredit(purchaseId: string, signalId: bigint) {
  await wrapKeyFor(purchaseId);
  await db().update(purchases).set({ status: "KEY_SENT", updatedAt: new Date() }).where(eq(purchases.id, purchaseId));
  await enqueue(JOBS.notifyKeyDelivered, { purchaseId, signalId: signalId.toString() }, `key:${purchaseId}`);
}

export const purchaseRoutes = new Hono<AppEnv>()
  .post("/me/encryption-key", requireUser, async (c) => {
    const body = KeyBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw badRequest("bad_key", body.error.issues.map((i) => i.message).join("; "));
    await db().update(users).set({ pubkey: body.data.publicKey.toLowerCase() }).where(eq(users.id, getAuth(c).userId!));
    return c.json({ ok: true, publicKey: body.data.publicKey.toLowerCase() });
  })
  .post("/purchases", requireUser, async (c) => {
    const a = getAuth(c);
    const body = CreateBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw badRequest("bad_body", body.error.issues.map((i) => i.message).join("; "));
    const { signalId, compliance } = body.data;
    const payer = await payerOf(a);

    const s = await db().query.signals.findFirst({ where: eq(signals.id, signalId) });
    if (!s) throw notFound("Signal");
    if (!OPEN_STATUSES.includes(s.status) || s.outcome) throw conflict("signal_closed", "Signal is no longer open");
    if (s.validUntil <= new Date()) throw conflict("signal_expired", "Signal has expired");
    if (s.source !== "chain") throw conflict("not_on_chain", "Demo signals cannot be bought");
    // without key material nobody could ever read it: refuse before anyone pays or claims
    if (!s.aesKeyEnc) throw conflict("no_key_material", NO_KEY);
    const price = BigInt(s.price);

    const provider = await db().query.providers.findFirst({ where: eq(providers.id, s.providerId) });
    if (!provider) throw notFound("Provider");
    if (provider.userId === a.userId || getAddress(provider.address) === payer) {
      throw forbidden("You cannot buy your own signal");
    }

    const existing = await db().query.purchases.findFirst({
      where: and(eq(purchases.signalId, signalId), eq(purchases.buyerAddress, payer.toLowerCase())),
    });
    if (price > 0n && existing && !RETRYABLE_STATUSES.includes(existing.status) && existing.status !== "PENDING") {
      throw conflict("already_bought", "You already bought this signal");
    }

    const buyer = await db().query.users.findFirst({ where: eq(users.id, a.userId!) });
    const agent = a.agentId ? await db().query.agents.findFirst({ where: eq(agents.id, a.agentId) }) : undefined;
    if (!(agent?.encPubkey ?? buyer?.pubkey)) throw conflict("no_encryption_key", "Register an encryption key first (POST /me/encryption-key)");

    // Free (practice) signal: nothing to pay or escrow, so no bond is locked. The key is wrapped to
    // the buyer straight away; the claim still counts as a subscriber and gets the result DM.
    if (price === 0n) {
      if (existing && PAID_STATUSES.includes(existing.status)) return c.json({ purchaseId: existing.id, status: existing.status, intent: null });
      const free = {
        signalId,
        buyerUserId: a.userId,
        agentId: a.agentId ?? null,
        buyerAddress: payer.toLowerCase(),
        amount: "0",
        token: paymentToken(env().CHAIN_ID).toLowerCase(),
        rail: "free",
        status: "CREDITED",
        outcomeClass: "ACCEPT",
        updatedAt: new Date(),
      };
      // claim and key delivery together: a failed wrap leaves no half-made claim behind
      const id = await db().transaction(async (tx) => {
        const [p] = existing
          ? await tx.update(purchases).set(free).where(eq(purchases.id, existing.id)).returning()
          : await tx.insert(purchases).values(free).returning();
        await wrapKeyFor(p!.id, "web", tx);
        await tx.update(purchases).set({ status: "KEY_SENT" }).where(eq(purchases.id, p!.id));
        return p!.id;
      });
      await enqueue(JOBS.notifyKeyDelivered, { purchaseId: id, signalId: signalId.toString() }, `key:${id}`);
      const p = { id };
      return c.json({ purchaseId: p!.id, status: "KEY_SENT", intent: null }, 201);
    }

    // Capacity: every credited subscriber locks `price` of the provider's bond.
    const paid = await db()
      .select({ id: purchases.id })
      .from(purchases)
      .where(and(eq(purchases.signalId, signalId), inArray(purchases.status, PAID_STATUSES)));
    const capacity = await publicClient().readContract({
      address: addr("ProviderRegistry"),
      abi: providerRegistryAbi,
      functionName: "capacity",
      args: [getAddress(provider.address), price],
    });
    if (capacity < 1n || paid.length >= (await subscriberCap())) {
      throw conflict("capacity_full", "This provider's bond cannot cover another buyer right now");
    }

    const token = body.data.token === "USDC_E" ? usdcE(env().CHAIN_ID) : paymentToken(env().CHAIN_ID);
    // a signal's pot holds one token: the first credit fixes it on-chain, so a second buyer in the
    // other token would pay and then fail to credit. Refuse before any money moves.
    const locked = await potToken(signalId, existing?.id);
    if (locked && getAddress(locked) !== getAddress(token)) {
      const sym = getAddress(locked) === getAddress(usdcE(env().CHAIN_ID)) ? "USDC_E" : "USDT";
      throw new ApiError(409, "token_locked", `This signal is paid in ${sym === "USDC_E" ? "USDC" : "USDT"}; pay with that token`, { token: sym });
    }
    const intent = await paymentRail().createIntent({ signalId, payer, token, amount: price, compliance });
    const values = {
      signalId,
      buyerUserId: a.userId,
      agentId: a.agentId ?? null,
      buyerAddress: payer.toLowerCase(),
      amount: price.toString(),
      token: token.toLowerCase(),
      rail: paymentRail().name,
      hspPaymentId: intent.intentId,
      mandateJson: intent.mandateTypedData ?? intent.checkout ?? null,
      status: "PENDING",
      txHash: null,
      outcomeClass: null,
      rejectReason: null,
      recoveryTx: null,
      receiptHash: null,
      idempotencyKey: null,
      updatedAt: new Date(),
    };
    const [p] = existing
      ? await db().update(purchases).set(values).where(eq(purchases.id, existing.id)).returning()
      : await db().insert(purchases).values(values).returning();
    return c.json({ purchaseId: p!.id, status: p!.status, intent }, existing ? 200 : 201);
  })
  /** HSP gateway rail: poll the gateway for this purchase (the webhook does the same push-side). */
  .post("/purchases/:id/sync", requireUser, async (c) => {
    const p = await ownPurchase(c.req.param("id"), getAuth(c));
    return c.json(purchaseView(await syncGatewayPurchase(p)));
  })
  .post("/purchases/:id/submit", requireUser, async (c) => {
    const idem = c.req.header("idempotency-key");
    if (!idem) throw badRequest("idempotency_key_required", "Send an Idempotency-Key header");
    const p = await ownPurchase(c.req.param("id"), getAuth(c));
    const body = SubmitBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw badRequest("bad_body", "mandateSig and txHash required");

    if (p.status !== "PENDING") {
      if (p.idempotencyKey === idem || p.txHash === body.data.txHash.toLowerCase()) return c.json(purchaseView(p));
      throw conflict("already_submitted", `Purchase is ${p.status}`);
    }
    const dup = await db().query.purchases.findFirst({ where: eq(purchases.txHash, body.data.txHash.toLowerCase()) });
    if (dup && dup.id !== p.id) throw conflict("tx_reused", "Transaction already used for another purchase");

    const { paymentId } = await paymentRail().submit({
      intentId: p.hspPaymentId!,
      mandateSig: body.data.mandateSig as Hex,
      txHash: body.data.txHash as Hex,
    });
    const [u] = await db()
      .update(purchases)
      .set({ status: "SUBMITTED", txHash: body.data.txHash.toLowerCase(), hspPaymentId: paymentId, idempotencyKey: idem, updatedAt: new Date() })
      .where(and(eq(purchases.id, p.id), eq(purchases.status, "PENDING")))
      .returning();
    await enqueue(JOBS.hspVerify, { purchaseId: p.id, attempt: 0 }, `verify:${p.id}:0`);
    return c.json(purchaseView(u ?? p), 202);
  })
  /** USDC.e fast path: one EIP-3009 authorisation, relayed into `fundWithAuthorization`. */
  .post("/purchases/:id/authorize", requireUser, async (c) => {
    if (!env().FAST_PATH_ENABLED) throw new ApiError(404, "not_enabled", "Fast path is disabled");
    const p = await ownPurchase(c.req.param("id"), getAuth(c));
    if (PAID_STATUSES.includes(p.status)) return c.json(purchaseView(p));
    if (p.status !== "PENDING") throw conflict("already_submitted", `Purchase is ${p.status}`);
    const body = AuthorizeBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw badRequest("bad_body", body.error.issues.map((i) => i.message).join("; "));
    const { authorization: au, signature } = body.data;
    const escrow = addr("PerformanceEscrow");
    if (getAddress(p.token) !== getAddress(usdcE(env().CHAIN_ID))) throw badRequest("wrong_token", "Fast path is USDC.e only");
    if (getAddress(au.from) !== getAddress(p.buyerAddress) || getAddress(au.to) !== escrow) {
      throw badRequest("bad_authorization", "Authorization must be from the buyer to the escrow");
    }
    if (au.value !== BigInt(p.amount)) throw badRequest("wrong_amount", "Authorization value must equal the price");
    const nonce = keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }], [p.signalId, getAddress(au.from)]));
    if (au.nonce.toLowerCase() !== nonce) throw badRequest("bad_nonce", "nonce must be keccak256(abi.encode(signalId, from))");
    const { v, r, s, yParity } = parseSignature(signature as Hex);
    const r1 = await relay({
      key: `fund3009:${p.id}`,
      purpose: "fundWithAuthorization",
      to: escrow,
      data: encodeFunctionData({
        abi: performanceEscrowAbi,
        functionName: "fundWithAuthorization",
        args: [p.signalId, getAddress(au.from), au.value, au.validAfter, au.validBefore, nonce, Number(v ?? BigInt(27 + (yParity ?? 0))), r, s],
      }),
    });
    const receiptHash = keccak256(encodeAbiParameters([{ type: "string" }, { type: "bytes32" }], ["eip3009", nonce]));
    // TODO(hsp-live): when HSP_FACILITATOR_URL is set, also register the payment via the x402 flow.
    await db().transaction(async (tx) => {
      await tx
        .update(purchases)
        .set({ rail: "eip3009", status: "CREDITED", outcomeClass: "ACCEPT", receiptHash, creditedTx: r1.hash, txHash: r1.hash, explorerUrl: explorerTxUrl(r1.hash) ?? null, updatedAt: new Date() })
        .where(eq(purchases.id, p.id));
    });
    await afterCredit(p.id, p.signalId);
    const done = await db().query.purchases.findFirst({ where: eq(purchases.id, p.id) });
    return c.json(purchaseView(done!));
  })
  .get("/purchases/:id", requireUser, async (c) => c.json(purchaseView(await ownPurchase(c.req.param("id"), getAuth(c)))))
  .get("/purchases/:id/key", requireUser, async (c) => {
    const p = await ownPurchase(c.req.param("id"), getAuth(c));
    const d = await db().query.keyDeliveries.findFirst({ where: eq(keyDeliveries.purchaseId, p.id) });
    const s = await db().query.signals.findFirst({ where: eq(signals.id, p.signalId) });
    if (!d && !s?.aesKeyEnc) throw conflict("no_key_material", NO_KEY);
    if (!d) throw conflict("key_not_ready", `Key not delivered yet (status ${p.status})`);
    if (!s?.ciphertext) throw notFound("Ciphertext");
    return c.json({ purchaseId: p.id, signalId: p.signalId.toString(), wrappedKey: d.wrappedKey, ...splitCiphertext(s.ciphertext) });
  })
  .get("/me/subscriber", requireUser, async (c) => {
    const a = getAuth(c);
    const rows = await db()
      .select({ p: purchases, s: signals, pr: { handle: providers.handle, displayName: providers.displayName, kind: providers.kind } })
      .from(purchases)
      .innerJoin(signals, eq(signals.id, purchases.signalId))
      .innerJoin(providers, eq(providers.id, signals.providerId))
      .where(eq(purchases.buyerUserId, a.userId!))
      .orderBy(desc(purchases.createdAt))
      .limit(100);
    let spent = 0n;
    let refunded = 0n;
    for (const { p } of rows) {
      if (PAID_STATUSES.includes(p.status)) spent += BigInt(p.amount);
      if (p.status === "REFUNDED") refunded += BigInt(p.amount);
    }
    const me = await db().query.users.findFirst({ where: eq(users.id, a.userId!) });
    return c.json({
      wallet: me?.wallet ?? null,
      hasEncryptionKey: Boolean(me?.pubkey),
      totals: { spentUsd: fromUnits(spent), refundedUsd: fromUnits(refunded), purchases: rows.length },
      purchases: rows.map(({ p, s, pr }) => ({ ...purchaseView(p), signal: publicSignal(s, pr) })),
    });
  })
  // ── internal (keeper, reveal job)
  .get("/internal/signals/:id/reveal-material", requireInternal, async (c) => {
    const s = await revealMaterial(BigInt(c.req.param("id")));
    return c.json(serializeSignal(s));
  })
  .post("/internal/signals/:id/reveal", requireInternal, async (c) => c.json(await revealSignal(BigInt(c.req.param("id")))));
