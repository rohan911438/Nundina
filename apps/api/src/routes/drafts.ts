import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { encodeFunctionData, getAddress, parseEventLogs, verifyTypedData, type Address, type Hex } from "viem";
import { z } from "zod";
import {
  COMMIT_AUTH_TYPES,
  MARKETS,
  hashSignal,
  makeSignalSchema,
  marketById,
  nundinaDomain,
  serializeSignal,
  type Signal,
} from "@nundina/shared";
import { signalBookAbi } from "@nundina/shared/abis";
import { db } from "../db/client.js";
import { providers, signalDrafts, signals } from "../db/schema.js";
import { env } from "../env.js";
import { getAuth, requireUser, type AppEnv, type Auth } from "../auth/context.js";
import { addr, publicClient } from "../chain/clients.js";
import { relay } from "../chain/relayer.js";
import { enqueue, JOBS } from "../jobs/queue.js";
import { scheduleSafetyReveal } from "../jobs/reveal.js";
import { ApiError, badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { random32Hex } from "../lib/crypto.js";
import { sealHex, unsealHex } from "../keys/masterKey.js";
import { encryptSignal } from "../keys/keyService.js";

/** How long a provider has to sign after `prepare`. */
const AUTH_DEADLINE_S = 30 * 60;

const CreateDraftBody = z.object({
  /** Internal callers (bot, agents) name the provider; users post as themselves. */
  providerHandle: z.string().optional(),
  rawText: z.string().min(1).max(4000),
  parsed: z.record(z.string(), z.unknown()).optional(),
  parser: z.enum(["rules", "llm", "manual", "agent"]).default("manual"),
  sourceChatId: z.number().int().optional(),
  sourceMessageId: z.number().int().optional(),
});

const big = z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).transform((v) => BigInt(v));
/** Signal fields the provider chooses; the server adds `provider` and `salt`. */
const SignalInput = z.object({
  market: z.string(),
  side: z.union([z.literal(0), z.literal(1), z.enum(["LONG", "SHORT"])]).transform((s) => (s === "LONG" || s === 0 ? 0 : 1)),
  entry: big,
  takeProfit: big,
  stopLoss: big,
  validUntil: big,
  pricePerSub: big,
  upstream: z.array(big).default([]),
  upstreamBps: z.array(z.number().int()).default([]),
});
type SignalInput = z.infer<typeof SignalInput>;

const CommitAuthBody = z.object({
  provider: z.string(),
  commitHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  market: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  validUntil: big,
  pricePerSub: big,
  nonce: big,
  deadline: big,
});

const ConfirmBody = z.object({
  signal: SignalInput.extend({ provider: z.string().optional() }),
  commitAuth: CommitAuthBody,
  providerSig: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

function marketHex(m: string): { id: Hex; label: string } {
  const byLabel = MARKETS[m as keyof typeof MARKETS];
  if (byLabel) return { id: byLabel.id, label: byLabel.label };
  const byId = marketById(m);
  if (byId) return { id: byId.id, label: byId.label };
  throw badRequest("bad_market", `Unknown market ${m}`);
}

function toSignal(input: SignalInput, provider: Address, salt: Hex): Signal {
  const parsed = makeSignalSchema().safeParse({
    ...input,
    market: marketHex(input.market).id,
    provider,
    salt,
  });
  if (!parsed.success) throw badRequest("bad_signal", parsed.error.issues.map((i) => i.message).join("; "));
  return parsed.data as Signal;
}

/** Loads a draft and checks the caller owns it (internal callers may act for any provider). */
async function ownedDraft(id: number, auth: Auth) {
  const draft = await db().query.signalDrafts.findFirst({ where: eq(signalDrafts.id, id) });
  if (!draft) throw notFound("Draft");
  const provider = await db().query.providers.findFirst({ where: eq(providers.id, draft.providerId) });
  if (!provider) throw notFound("Provider");
  if (auth.kind !== "internal" || auth.userId) {
    if (!auth.userId || provider.userId !== auth.userId) throw forbidden("Not your draft");
  }
  return { draft, provider };
}

export const draftRoutes = new Hono<AppEnv>()
  .post("/drafts", async (c) => {
    const a = getAuth(c);
    const body = CreateDraftBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw badRequest("bad_body", body.error.issues.map((i) => i.message).join("; "));
    const b = body.data;
    let provider;
    if (a.kind === "internal" && b.providerHandle) {
      provider = await db().query.providers.findFirst({ where: eq(providers.handle, b.providerHandle) });
    } else if (a.userId) {
      provider = await db().query.providers.findFirst({ where: eq(providers.userId, a.userId) });
    } else {
      throw forbidden("Sign in or use the internal secret");
    }
    if (!provider) throw notFound("Provider");
    const [d] = await db()
      .insert(signalDrafts)
      .values({
        providerId: provider.id,
        rawText: b.rawText,
        parsedJson: b.parsed,
        parser: b.parser,
        sourceChatId: b.sourceChatId,
        sourceMessageId: b.sourceMessageId,
      })
      .returning();
    return c.json({ id: d!.id, status: d!.status }, 201);
  })
  /**
   * Freezes the signal, generates the salt, and returns the EIP-712 CommitAuthorization for the
   * provider to sign. The salt is stored sealed on the draft.
   */
  .post("/drafts/:id/prepare", requireUser, async (c) => {
    const { draft, provider } = await ownedDraft(Number(c.req.param("id")), getAuth(c));
    if (draft.status === "committed") throw conflict("already_committed", "Draft already committed");
    const input = SignalInput.safeParse(await c.req.json().catch(() => ({})));
    if (!input.success) throw badRequest("bad_signal", input.error.issues.map((i) => i.message).join("; "));

    const providerAddr = getAddress(provider.address);
    const salt = random32Hex();
    const signal = toSignal(input.data, providerAddr, salt);
    const signalBook = addr("SignalBook");
    const commitHash = hashSignal(signal, env().CHAIN_ID, signalBook);
    const nonce = await publicClient().readContract({
      address: signalBook,
      abi: signalBookAbi,
      functionName: "nonces",
      args: [providerAddr],
    });
    // SignalBook checks the deadline against block time, which can run ahead of this server's clock
    const block = await publicClient().getBlock().catch(() => null);
    const nowS = Math.max(Math.floor(Date.now() / 1000), Number(block?.timestamp ?? 0));
    const deadline = BigInt(nowS + AUTH_DEADLINE_S);

    const { salt: _omit, ...withoutSalt } = serializeSignal(signal);
    await db()
      .update(signalDrafts)
      .set({ status: "prepared", signalJson: withoutSalt, saltEnc: sealHex(salt), commitHash, updatedAt: new Date() })
      .where(eq(signalDrafts.id, draft.id));

    const message = {
      provider: providerAddr,
      commitHash,
      market: signal.market,
      validUntil: signal.validUntil.toString(),
      pricePerSub: signal.pricePerSub.toString(),
      nonce: nonce.toString(),
      deadline: deadline.toString(),
    };
    return c.json({
      salt,
      commitHash,
      typedData: {
        domain: nundinaDomain(env().CHAIN_ID, signalBook),
        types: COMMIT_AUTH_TYPES,
        primaryType: "CommitAuthorization",
        message,
      },
    });
  })
  /** Verifies the provider's signature, encrypts the body, relays SignalBook.commit. Idempotent by draft id. */
  .post("/drafts/:id/confirm", requireUser, async (c) => {
    const { draft, provider } = await ownedDraft(Number(c.req.param("id")), getAuth(c));
    if (draft.status === "committed" && draft.signalId != null) {
      return c.json({ signalId: draft.signalId.toString(), commitHash: draft.commitHash, status: "COMMITTED" });
    }
    if (draft.status !== "prepared" || !draft.saltEnc || !draft.commitHash) {
      throw conflict("not_prepared", "Call /drafts/:id/prepare first");
    }
    const body = ConfirmBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw badRequest("bad_body", body.error.issues.map((i) => i.message).join("; "));
    const { signal: input, commitAuth, providerSig } = body.data;

    const providerAddr = getAddress(provider.address);
    const salt = unsealHex(draft.saltEnc);
    const signal = toSignal(input, providerAddr, salt);
    const signalBook = addr("SignalBook");
    const commitHash = hashSignal(signal, env().CHAIN_ID, signalBook);

    if (commitHash !== draft.commitHash) throw badRequest("signal_changed", "Signal differs from the prepared draft");
    if (commitAuth.commitHash.toLowerCase() !== commitHash.toLowerCase()) {
      throw badRequest("hash_mismatch", "commitAuth.commitHash does not match the signal");
    }
    if (getAddress(commitAuth.provider) !== providerAddr) throw badRequest("wrong_provider", "commitAuth.provider mismatch");
    if (commitAuth.market.toLowerCase() !== signal.market.toLowerCase() || commitAuth.validUntil !== signal.validUntil) {
      throw badRequest("auth_mismatch", "commitAuth fields do not match the signal");
    }
    if (commitAuth.pricePerSub !== signal.pricePerSub) throw badRequest("auth_mismatch", "pricePerSub mismatch");

    const auth = {
      provider: providerAddr,
      commitHash: commitHash,
      market: signal.market,
      validUntil: signal.validUntil,
      pricePerSub: signal.pricePerSub,
      nonce: commitAuth.nonce,
      deadline: commitAuth.deadline,
    };
    const okSig = await verifyTypedData({
      address: providerAddr,
      domain: nundinaDomain(env().CHAIN_ID, signalBook),
      types: COMMIT_AUTH_TYPES,
      primaryType: "CommitAuthorization",
      message: auth,
      signature: providerSig as Hex,
    }).catch(() => false);
    // Smart-account providers (ERC-1271) are checked on-chain by the contract instead.
    if (!okSig) {
      const code = await publicClient().getCode({ address: providerAddr }).catch(() => undefined);
      if (!code || code === "0x") throw badRequest("bad_signature", "Signature does not match the provider");
    }

    const enc = encryptSignal(signal);
    const cipherUri = `nundina://drafts/${draft.id}`;
    const data = encodeFunctionData({
      abi: signalBookAbi,
      functionName: "commit",
      args: [auth, providerSig as Hex, signal.upstream, signal.upstreamBps, cipherUri],
    });
    const result = await relay({ key: `commit:draft:${draft.id}`, purpose: "commit", to: signalBook, data });

    const receipt = result.receipt ?? (await publicClient().getTransactionReceipt({ hash: result.hash }));
    const [ev] = parseEventLogs({ abi: signalBookAbi, eventName: "SignalCommitted", logs: receipt.logs });
    if (!ev) throw new ApiError(502, "no_event", "Commit mined but SignalCommitted not found", { hash: result.hash });
    const args = ev.args as { id: bigint; oraclePrice: bigint };
    const block = await publicClient().getBlock({ blockNumber: receipt.blockNumber });

    const market = marketHex(signal.market).label;
    await db().transaction(async (tx) => {
      await tx
        .insert(signals)
        .values({
          id: args.id,
          providerId: provider.id,
          commitHash,
          market,
          marketId: signal.market,
          validUntil: new Date(Number(signal.validUntil) * 1000),
          committedAt: new Date(Number(block.timestamp) * 1000),
          price: signal.pricePerSub.toString(),
          oraclePrice: args.oraclePrice.toString(),
          cipherUri,
          ciphertext: enc.ciphertext,
          aesKeyEnc: enc.aesKeyEnc,
          saltEnc: draft.saltEnc,
          status: "COMMITTED",
          upstreamJson: signal.upstream.map((id, i) => ({ id: id.toString(), bps: signal.upstreamBps[i] ?? 0 })),
          commitTx: result.hash,
          tgChatId: draft.sourceChatId,
          tgMessageId: draft.sourceMessageId,
        })
        // The indexer (prompt 08) may have inserted the row from the SignalCommitted event first:
        // fill in the off-chain material, but only for the same commitment.
        .onConflictDoUpdate({
          target: signals.id,
          set: {
            ciphertext: enc.ciphertext,
            aesKeyEnc: enc.aesKeyEnc,
            saltEnc: draft.saltEnc,
            cipherUri,
            commitTx: result.hash,
            tgChatId: draft.sourceChatId,
            tgMessageId: draft.sourceMessageId,
            updatedAt: new Date(),
          },
          setWhere: eq(signals.commitHash, commitHash),
        });
      await tx
        .update(signalDrafts)
        .set({ status: "committed", signalId: args.id, updatedAt: new Date() })
        .where(eq(signalDrafts.id, draft.id));
    });
    await enqueue(JOBS.notifyLocked, { signalId: args.id.toString(), providerId: provider.id }, `locked:${args.id}`);
    await scheduleSafetyReveal(args.id, new Date(Number(signal.validUntil) * 1000));

    return c.json({ signalId: args.id.toString(), commitHash, txHash: result.hash, status: "COMMITTED" }, 201);
  });

