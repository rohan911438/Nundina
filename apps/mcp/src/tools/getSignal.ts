import { z } from "zod";
import { txUrl } from "../chain.js";
import { NOT_ADVICE, guarded, ok, type Ctx } from "./common.js";
import { summarize } from "./getSignals.js";

export const getSignalInput = { id: z.string().regex(/^\d+$/).describe("Signal id") };

export const getSignalOutput = {
  signal: z.record(z.string(), z.unknown()),
  commitHash: z.string(),
  oraclePriceAtCommit: z.string().nullable(),
  upstreamTree: z.array(z.unknown()),
  settlement: z.unknown(),
  hspPaymentIds: z.array(z.string()),
  proofs: z.record(z.string(), z.string().nullable()),
  explorer: z.record(z.string(), z.string().nullable()),
  note: z.string(),
};

export const getSignalMeta = {
  title: "Get one signal",
  description: `Free. Signal detail with its proofs: commit hash, oracle price at commit, commit/reveal/resolve/settle transactions with explorer links, HSP payment ids of buyers, and the upstream tree for aggregator signals. Plaintext only after reveal. ${NOT_ADVICE}`,
};

export function getSignal(ctx: Ctx) {
  return (a: { id: string }) =>
    guarded(async () => {
      const s = await ctx.anon.get<any>(`/signals/${a.id}`);
      const proofs = { commitTx: s.tx?.commit ?? null, revealTx: s.tx?.reveal ?? null, resolveTx: s.tx?.resolve ?? null, proofTx: s.settlement?.proofTx ?? null, settleTx: s.settlement?.settleTx ?? null };
      return ok({
        signal: summarize(s),
        commitHash: s.commitHash,
        oraclePriceAtCommit: s.oraclePriceAtCommit,
        upstreamTree: s.upstreamTree ?? [],
        settlement: s.settlement ?? null,
        hspPaymentIds: s.paymentIds ?? [],
        proofs,
        explorer: Object.fromEntries(Object.entries(proofs).map(([k, v]) => [k, txUrl(v)])),
        note: NOT_ADVICE,
      });
    });
}
