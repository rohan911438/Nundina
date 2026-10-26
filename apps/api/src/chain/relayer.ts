import {
  BaseError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import {
  outcomeResolverAbi,
  performanceEscrowAbi,
  providerRegistryAbi,
  revenueRouterAbi,
  signalBookAbi,
} from "@nundina/shared/abis";
import { eq } from "drizzle-orm";
import { db, sql } from "../db/client.js";
import { relayedTxs } from "../db/schema.js";
import { env } from "../env.js";
import { log } from "../lib/log.js";
import { ApiError } from "../lib/errors.js";
import { publicClient, relayerAccount, relayerClient } from "./clients.js";

const RESUBMIT_AFTER_MS = 60_000;
const MAX_ATTEMPTS = 5;
const GAS_MULTIPLIER = 120n; // %
const BUMP = 115n; // %

export interface RelayRequest {
  /** Idempotency key, e.g. `commit:draft:42`. Same key → same transaction. */
  key: string;
  purpose: string;
  to: Address;
  data: Hex;
}

export interface RelayResult {
  hash: Hex;
  status: "mined" | "failed";
  receipt?: TransactionReceipt;
}

let chain: Promise<unknown> = Promise.resolve();
/** In-process serialisation; the DB advisory lock covers multiple processes. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

export async function relayerBalance(): Promise<bigint | null> {
  const a = relayerAccount();
  if (!a) return null;
  return publicClient().getBalance({ address: a.address });
}

/** Sends (or returns the existing) transaction for `req.key` and waits for it to be mined. */
export async function relay(req: RelayRequest): Promise<RelayResult> {
  const existing = await db().query.relayedTxs.findFirst({ where: eq(relayedTxs.idempotencyKey, req.key) });
  if (existing?.status === "mined" && existing.hash) return { hash: existing.hash as Hex, status: "mined" };
  if (existing?.status === "sent" && existing.hash) return waitAndBump(existing.id);
  if (existing?.status === "failed") {
    throw new ApiError(422, "tx_failed", existing.error ?? "Relayed transaction failed", { key: req.key });
  }

  const account = relayerAccount();
  if (!account) throw new ApiError(503, "relayer_unconfigured", "Relayer wallet is not configured");

  if (!existing) {
    await db()
      .insert(relayedTxs)
      .values({
        idempotencyKey: req.key,
        purpose: req.purpose,
        chainId: env().CHAIN_ID,
        from: account.address,
        to: req.to,
        data: req.data,
      })
      .onConflictDoNothing();
  }
  const row = await db().query.relayedTxs.findFirst({ where: eq(relayedTxs.idempotencyKey, req.key) });
  if (!row) throw new Error("relayed tx row missing");

  await serial(() => send(row.id, req));
  return waitAndBump(row.id);
}

async function send(rowId: number, req: RelayRequest) {
  const pc = publicClient();
  const account = relayerAccount()!;
  await sql().begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext('nundina-relayer'))`;
    const [current] = await tx`select status, hash from relayed_txs where id = ${rowId} for update`;
    if (current?.status !== "queued") return; // someone else sent it

    const balance = await pc.getBalance({ address: account.address });
    if (balance < env().RELAYER_MIN_BALANCE_WEI) {
      throw new ApiError(503, "relayer_low_balance", "Relayer balance below threshold");
    }
    let gas: bigint;
    try {
      gas = await pc.estimateGas({ account, to: req.to, data: req.data });
    } catch (e) {
      const reason = revertReason(e);
      await tx`update relayed_txs set status = 'failed', error = ${reason}, updated_at = now() where id = ${rowId}`;
      throw new ApiError(422, "tx_would_revert", reason, { purpose: req.purpose });
    }
    const gasPrice = await pc.getGasPrice();
    const nonce = await pc.getTransactionCount({ address: account.address, blockTag: "pending" });
    const hash = await relayerClient().sendTransaction({
      account,
      chain: relayerClient().chain,
      to: req.to,
      data: req.data,
      gas: (gas * GAS_MULTIPLIER) / 100n,
      gasPrice,
      nonce,
    });
    await tx`update relayed_txs set status = 'sent', hash = ${hash}, nonce = ${nonce},
      gas_price = ${gasPrice.toString()}, attempts = attempts + 1, updated_at = now() where id = ${rowId}`;
    log.info({ purpose: req.purpose, hash, nonce }, "relayed tx sent");
  });
}

/** Waits for the receipt; resubmits with +15% gas price every 60s (same nonce). */
async function waitAndBump(rowId: number): Promise<RelayResult> {
  const pc = publicClient();
  for (;;) {
    const row = await db().query.relayedTxs.findFirst({ where: eq(relayedTxs.id, rowId) });
    if (!row?.hash) throw new Error("relayed tx has no hash");
    try {
      const receipt = await pc.waitForTransactionReceipt({ hash: row.hash as Hex, timeout: RESUBMIT_AFTER_MS });
      const status = receipt.status === "success" ? "mined" : "failed";
      await db()
        .update(relayedTxs)
        .set({
          status,
          blockNumber: Number(receipt.blockNumber),
          error: status === "failed" ? "reverted" : null,
          updatedAt: new Date(),
        })
        .where(eq(relayedTxs.id, rowId));
      if (status === "failed") throw new ApiError(422, "tx_reverted", "Transaction reverted", { hash: row.hash });
      return { hash: row.hash as Hex, status, receipt };
    } catch (e) {
      if (e instanceof ApiError) throw e;
      if (row.attempts >= MAX_ATTEMPTS) {
        await db()
          .update(relayedTxs)
          .set({ status: "failed", error: "not mined after max attempts", updatedAt: new Date() })
          .where(eq(relayedTxs.id, rowId));
        throw new ApiError(504, "tx_timeout", "Transaction not mined", { hash: row.hash });
      }
      await serial(() => bump(rowId));
    }
  }
}

async function bump(rowId: number) {
  const row = await db().query.relayedTxs.findFirst({ where: eq(relayedTxs.id, rowId) });
  if (!row || row.status !== "sent" || row.nonce == null) return;
  const account = relayerAccount()!;
  const gasPrice = (BigInt(row.gasPrice ?? "0") * BUMP) / 100n;
  const pc = publicClient();
  const gas = await pc.estimateGas({ account, to: row.to as Address, data: row.data as Hex }).catch(() => 500_000n);
  const hash = await relayerClient().sendTransaction({
    account,
    chain: relayerClient().chain,
    to: row.to as Address,
    data: row.data as Hex,
    gas: (gas * GAS_MULTIPLIER) / 100n,
    gasPrice,
    nonce: row.nonce,
  });
  await db()
    .update(relayedTxs)
    .set({ hash, gasPrice: gasPrice.toString(), attempts: row.attempts + 1, updatedAt: new Date() })
    .where(eq(relayedTxs.id, rowId));
  log.warn({ rowId, hash, gasPrice: gasPrice.toString() }, "relayed tx resubmitted with higher gas");
}

const ALL_ERRORS = [
  ...signalBookAbi,
  ...performanceEscrowAbi,
  ...providerRegistryAbi,
  ...outcomeResolverAbi,
  ...revenueRouterAbi,
].filter((x) => x.type === "error");

/** Best-effort human-readable revert reason, decoding Nundina custom errors. */
export function revertReason(e: unknown): string {
  if (e instanceof BaseError) {
    const revert = e.walk((err) => err instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError && revert.data?.errorName) return revert.data.errorName;
    const withData = e.walk((err) => typeof (err as { data?: unknown }).data === "string") as
      | { data?: string }
      | null;
    const raw = withData?.data;
    if (raw && /^0x[0-9a-fA-F]{8}/.test(raw)) {
      try {
        return decodeErrorResult({ abi: ALL_ERRORS, data: raw as Hex }).errorName;
      } catch {
        /* unknown selector */
      }
    }
    return e.shortMessage;
  }
  return e instanceof Error ? e.message : String(e);
}
