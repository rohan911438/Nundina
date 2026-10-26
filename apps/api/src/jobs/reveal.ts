import { eq } from "drizzle-orm";
import { encodeFunctionData } from "viem";
import { signalBookAbi } from "@nundina/shared/abis";
import { db } from "../db/client.js";
import { signals } from "../db/schema.js";
import { addr, publicClient } from "../chain/clients.js";
import { relay } from "../chain/relayer.js";
import { log } from "../lib/log.js";
import { revealMaterial } from "../keys/keyService.js";
import { enqueue, JOBS } from "./queue.js";

/** Safety reveal runs this long after `validUntil` (the reveal window is 6 h). */
export const SAFETY_REVEAL_DELAY_S = 3600;

/** Schedules the safety reveal for a freshly committed signal. */
export function scheduleSafetyReveal(signalId: bigint, validUntil: Date) {
  return enqueue(
    JOBS.reveal,
    { signalId: signalId.toString() },
    { startAfter: new Date(validUntil.getTime() + SAFETY_REVEAL_DELAY_S * 1000), singletonKey: `reveal:${signalId}` },
  );
}

/**
 * Publishes the plaintext with `SignalBook.reveal` unless it is already revealed (the keeper's
 * resolver path reveals as part of resolution). Mirrors the plaintext into the signals row.
 */
export async function revealSignal(signalId: bigint): Promise<{ revealed: boolean; tx?: string }> {
  const row = await db().query.signals.findFirst({ where: eq(signals.id, signalId) });
  if (!row || row.source !== "chain") return { revealed: false };
  const book = addr("SignalBook");
  const onchain = await publicClient().readContract({ address: book, abi: signalBookAbi, functionName: "isRevealed", args: [signalId] });

  const s = await revealMaterial(signalId);
  let tx: string | undefined;
  if (!onchain) {
    const r = await relay({
      key: `reveal:${signalId}`,
      purpose: "reveal",
      to: book,
      data: encodeFunctionData({ abi: signalBookAbi, functionName: "reveal", args: [signalId, s] }),
    });
    tx = r.hash;
  }
  const isLimit = await publicClient()
    .readContract({ address: book, abi: signalBookAbi, functionName: "isLimit", args: [signalId] })
    .catch(() => null);
  await db()
    .update(signals)
    .set({
      side: s.side,
      entry: s.entry.toString(),
      tp: s.takeProfit.toString(),
      sl: s.stopLoss.toString(),
      isLimit,
      revealTx: tx ?? row.revealTx,
      revealedAt: row.revealedAt ?? new Date(),
      status: row.status === "COMMITTED" ? "REVEALED" : row.status,
      updatedAt: new Date(),
    })
    .where(eq(signals.id, signalId));
  log.info({ signalId: signalId.toString(), tx }, "signal revealed");
  return { revealed: true, tx };
}
