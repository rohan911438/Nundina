/**
 * Projects Ponder's raw `onchain_event` rows into the API tables (signals, purchases, settlements,
 * providers). Each event is applied in one transaction together with the cursor, so a crash never
 * applies an event twice. `--reproject` resets every chain-derived column and replays from block 0.
 *
 * Side effects: after a `Settled` event it enqueues `score.recompute` and `notify.result` directly
 * into pg-boss (same database, same queue names as the API).
 */
import { fileURLToPath } from "node:url";
import { and, eq, inArray, sql as dsql } from "drizzle-orm";
import { createPublicClient, http, type Hex } from "viem";
import { marketById } from "@nundina/shared";
import { closeDb, db, sql } from "@nundina/api/db";
import { indexerCursor, keyDeliveries, providers, purchases, settlements, signals } from "@nundina/api/schema";
import { enqueue, JOBS, stopQueue } from "@nundina/api/jobs";

export const CURSOR = "main";
const BATCH = 500;
const OUTCOMES = ["NONE", "WIN", "LOSS", "VOID"] as const;
const PAID = ["CREDITED", "KEY_SENT", "SETTLED_WIN", "REFUNDED"];

export interface RawEvent {
  id: string;
  blockNumber: bigint;
  blockTimestamp: bigint;
  txHash: Hex;
  logIndex: number;
  contract: string;
  event: string;
  args: Record<string, any>;
}

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];
type Effect = () => Promise<unknown>;

const schemaName = () => process.env.INDEXER_DB_SCHEMA ?? "ponder";
const ts = (s: bigint) => new Date(Number(s) * 1000);
const lower = (a: string) => a.toLowerCase();

/** Reads the next batch of raw events after the cursor, up to `maxBlock`. */
export async function readEvents(after: { block: number; log: number }, maxBlock: bigint): Promise<RawEvent[]> {
  const rows = await sql().unsafe(
    `select id, block_number, block_timestamp, tx_hash, log_index, contract, event, args
       from "${schemaName()}".onchain_event
      where (block_number, log_index) > ($1, $2) and block_number <= $3
      order by block_number, log_index
      limit ${BATCH}`,
    [after.block, after.log, maxBlock.toString()],
  );
  return rows.map((r) => ({
    id: r.id,
    blockNumber: BigInt(r.block_number),
    blockTimestamp: BigInt(r.block_timestamp),
    txHash: r.tx_hash,
    logIndex: Number(r.log_index),
    contract: r.contract,
    event: r.event,
    args: typeof r.args === "string" ? JSON.parse(r.args) : r.args,
  }));
}

/** Provider row for an on-chain address; creates a minimal profile for providers who skipped the app. */
async function ensureProvider(tx: Tx, address: string, agentId?: string) {
  const a = lower(address);
  const [row] = await tx
    .insert(providers)
    .values({
      handle: `p_${a.slice(2, 10)}`,
      displayName: `${a.slice(0, 6)}…${a.slice(-4)}`,
      address: a,
      payoutAddr: a,
      erc8004Id: agentId,
      registeredOnChain: true,
    })
    .onConflictDoUpdate({
      target: providers.address,
      set: { registeredOnChain: true, ...(agentId ? { erc8004Id: agentId } : {}) },
    })
    .returning({ id: providers.id });
  return row!.id;
}

async function providerIdOf(tx: Tx, address: string) {
  const p = await tx.query.providers.findFirst({ where: eq(providers.address, lower(address)) });
  return p?.id ?? (await ensureProvider(tx, address));
}

/** Applies one event. Returns side effects to run after the transaction commits. */
export async function project(tx: Tx, ev: RawEvent): Promise<Effect[]> {
  const a = ev.args;
  const effects: Effect[] = [];
  switch (ev.event) {
    // ── ProviderRegistry
    case "ProviderRegistered":
      await ensureProvider(tx, a.provider, a.agentId);
      break;
    case "BondDeposited":
      await tx.update(providers).set({ bondTotal: dsql`${providers.bondTotal} + ${a.amount}`, bondToken: lower(a.token) }).where(eq(providers.address, lower(a.provider)));
      break;
    case "BondWithdrawn":
    case "BondSlashed":
      await tx.update(providers).set({ bondTotal: dsql`greatest(${providers.bondTotal} - ${a.amount}, 0)` }).where(eq(providers.address, lower(a.provider)));
      break;
    case "BondLocked":
      await tx.update(providers).set({ bondLocked: dsql`${providers.bondLocked} + ${a.amount}` }).where(eq(providers.address, lower(a.provider)));
      break;
    case "BondUnlocked":
      await tx.update(providers).set({ bondLocked: dsql`greatest(${providers.bondLocked} - ${a.amount}, 0)` }).where(eq(providers.address, lower(a.provider)));
      break;
    case "KycSet":
      await tx.update(providers).set({ kycUntil: Number(a.until) ? ts(BigInt(a.until)) : null }).where(eq(providers.address, lower(a.provider)));
      break;

    // ── SignalBook
    case "SignalCommitted": {
      const providerId = await providerIdOf(tx, a.provider);
      const id = BigInt(a.id);
      await tx
        .insert(signals)
        .values({
          id,
          providerId,
          commitHash: a.commitHash,
          market: marketById(a.market)?.label ?? a.market,
          marketId: a.market,
          validUntil: ts(BigInt(a.validUntil)),
          committedAt: ts(ev.blockTimestamp),
          price: a.price,
          oraclePrice: a.oraclePrice,
          cipherUri: a.cipherURI,
          status: "COMMITTED",
          commitTx: ev.txHash,
          commitBlock: Number(ev.blockNumber),
          source: "chain",
        })
        // the API usually inserted the row first: only fill chain fields
        .onConflictDoUpdate({
          target: signals.id,
          set: { commitTx: ev.txHash, commitBlock: Number(ev.blockNumber), committedAt: ts(ev.blockTimestamp), oraclePrice: a.oraclePrice },
        });
      break;
    }
    case "SignalUpstream":
      await tx
        .update(signals)
        .set({ upstreamJson: (a.upstream as string[]).map((u, i) => ({ id: String(u), bps: Number(a.upstreamBps[i]) })) })
        .where(eq(signals.id, BigInt(a.id)));
      break;
    case "SignalRevealed": {
      const s = a.s;
      await tx
        .update(signals)
        .set({
          side: Number(s.side),
          entry: s.entry,
          tp: s.takeProfit,
          sl: s.stopLoss,
          isLimit: Boolean(a.isLimit),
          revealTx: ev.txHash,
          revealedAt: ts(ev.blockTimestamp),
          status: dsql`case when ${signals.status} = 'COMMITTED' then 'REVEALED' else ${signals.status} end`,
          updatedAt: new Date(),
        })
        .where(eq(signals.id, BigInt(a.id)));
      break;
    }
    case "SignalUnrevealed":
      await tx
        .update(signals)
        .set({ status: "UNREVEALED_LOSS", outcome: "LOSS", rMultiple: "-1.00", decidedAt: ts(ev.blockTimestamp), updatedAt: new Date() })
        .where(eq(signals.id, BigInt(a.id)));
      break;

    // ── OutcomeResolver
    case "TouchProven":
    case "PendingExpiry":
      await tx
        .update(signals)
        .set({
          touchJson:
            ev.event === "TouchProven"
              ? { kind: "touch", level: Number(a.level), price: a.price, ts: a.ts, tx: ev.txHash }
              : { kind: "expiry", outcome: OUTCOMES[Number(a.outcome)], rX100: a.rX100, tx: ev.txHash },
          status: dsql`case when ${signals.status} in ('COMMITTED','REVEALED') then 'TOUCH_PENDING' else ${signals.status} end`,
          updatedAt: new Date(),
        })
        .where(eq(signals.id, BigInt(a.id)));
      break;
    case "Resolved":
      await tx
        .update(signals)
        .set({
          outcome: OUTCOMES[Number(a.outcome)],
          rMultiple: (Number(a.rX100) / 100).toFixed(2),
          resolveTx: ev.txHash,
          decidedAt: ts(ev.blockTimestamp),
          status: dsql`case when ${signals.status} in ('SETTLED','REFUNDED','UNREVEALED_LOSS') then ${signals.status} else 'RESOLVED' end`,
          updatedAt: new Date(),
        })
        .where(eq(signals.id, BigInt(a.id)));
      break;

    // ── PerformanceEscrow
    case "PaymentCredited": {
      const id = BigInt(a.id);
      const sub = lower(a.sub);
      const existing = await tx.query.purchases.findFirst({ where: and(eq(purchases.signalId, id), eq(purchases.buyerAddress, sub)) });
      if (existing) {
        await tx
          .update(purchases)
          .set({
            status: dsql`case when ${purchases.status} in ('PENDING','SUBMITTED','REJECTED','FAILED_RETRYABLE') then 'CREDITED' else ${purchases.status} end`,
            creditedTx: dsql`coalesce(${purchases.creditedTx}, ${ev.txHash})`,
            receiptHash: a.receiptHash,
            updatedAt: new Date(),
          })
          .where(eq(purchases.id, existing.id));
      } else {
        // paid outside the app (e.g. straight to the contract)
        await tx.insert(purchases).values({
          signalId: id,
          buyerAddress: sub,
          amount: a.amount,
          token: lower(a.token),
          rail: "onchain",
          receiptHash: a.receiptHash,
          txHash: Number(BigInt(a.txHash)) === 0 ? null : lower(a.txHash),
          creditedTx: ev.txHash,
          status: "CREDITED",
          createdAt: ts(ev.blockTimestamp),
        });
      }
      await tx
        .update(signals)
        .set({ purchaseCount: dsql`(select count(*)::int from purchases where signal_id = ${id} and status in ('CREDITED','KEY_SENT','SETTLED_WIN','REFUNDED'))` })
        .where(eq(signals.id, id));
      break;
    }
    case "Settled": {
      const id = BigInt(a.id);
      const outcome = OUTCOMES[Number(a.outcome)] ?? "NONE";
      await tx
        .insert(settlements)
        .values({ signalId: id, outcome, settleTx: ev.txHash, payout: a.payout, refundsTotal: a.refunds, slashTotal: a.slashed, settledAt: ts(ev.blockTimestamp) })
        .onConflictDoUpdate({
          target: settlements.signalId,
          set: { outcome, settleTx: ev.txHash, payout: a.payout, refundsTotal: a.refunds, slashTotal: a.slashed, settledAt: ts(ev.blockTimestamp) },
        });
      const sig = await tx.query.signals.findFirst({ where: eq(signals.id, id) });
      await tx
        .update(settlements)
        .set({ proofTx: sig?.resolveTx ?? null })
        .where(eq(settlements.signalId, id));
      await tx
        .update(signals)
        .set({
          status: dsql`case when ${signals.status} = 'UNREVEALED_LOSS' then ${signals.status} else 'SETTLED' end`,
          outcome: dsql`coalesce(${signals.outcome}, ${outcome})`,
          decidedAt: dsql`coalesce(${signals.decidedAt}, ${ts(ev.blockTimestamp).toISOString()}::timestamptz)`,
          updatedAt: new Date(),
        })
        .where(eq(signals.id, id));
      await tx
        .update(purchases)
        .set({ status: outcome === "WIN" ? "SETTLED_WIN" : "REFUNDED", updatedAt: new Date() })
        .where(and(eq(purchases.signalId, id), inArray(purchases.status, PAID)));
      if (sig) {
        effects.push(() => enqueue(JOBS.score, { providerId: sig.providerId }, `score:${sig.providerId}:${id}`));
        effects.push(() => enqueue(JOBS.notifyResult, { signalId: id.toString(), outcome }, `result:${id}`));
      }
      break;
    }
    case "Refunded":
      await tx
        .update(purchases)
        .set({ status: "REFUNDED", updatedAt: new Date() })
        .where(and(eq(purchases.signalId, BigInt(a.id)), eq(purchases.buyerAddress, lower(a.sub))));
      break;
    default:
      // Slashed, Recovered, Routed, Registered, NewFeedback: kept raw only
      break;
  }
  return effects;
}

async function cursor() {
  const c = await db().query.indexerCursor.findFirst({ where: eq(indexerCursor.name, CURSOR) });
  return { block: c?.blockNumber ?? 0, log: c?.logIndex ?? -1 };
}

/** Projects everything available; returns the number of events applied. */
export async function syncOnce(maxBlock: bigint): Promise<number> {
  let applied = 0;
  for (;;) {
    const events = await readEvents(await cursor(), maxBlock);
    if (!events.length) return applied;
    for (const ev of events) {
      const effects = await db().transaction(async (tx) => {
        const fx = await project(tx, ev);
        await tx
          .insert(indexerCursor)
          .values({ name: CURSOR, blockNumber: Number(ev.blockNumber), logIndex: ev.logIndex })
          .onConflictDoUpdate({
            target: indexerCursor.name,
            set: { blockNumber: Number(ev.blockNumber), logIndex: ev.logIndex, updatedAt: new Date() },
          });
        return fx;
      });
      for (const f of effects) await f();
      applied++;
    }
  }
}

/**
 * Resets every column the projector owns and moves the cursor back to the start, so the next
 * sync rebuilds the same state from the raw tables. Off-chain data (ciphertext, keys, drafts,
 * mandates, key deliveries) is untouched.
 */
export async function resetProjections() {
  await db().transaction(async (tx) => {
    await tx.delete(settlements).where(inArray(settlements.signalId, tx.select({ id: signals.id }).from(signals).where(eq(signals.source, "chain"))));
    await tx.delete(purchases).where(eq(purchases.rail, "onchain"));
    await tx.update(purchases).set({
      status: dsql`case
        when ${purchases.status} in ('SETTLED_WIN','REFUNDED') then
          case when exists (select 1 from ${keyDeliveries} kd where kd.purchase_id = ${purchases.id}) then 'KEY_SENT' else 'CREDITED' end
        else ${purchases.status} end`,
    });
    await tx
      .update(signals)
      .set({
        status: "COMMITTED",
        outcome: null,
        rMultiple: null,
        side: null,
        entry: null,
        tp: null,
        sl: null,
        isLimit: null,
        revealTx: null,
        revealedAt: null,
        resolveTx: null,
        decidedAt: null,
        touchJson: null,
        upstreamJson: [],
        commitBlock: null,
      })
      .where(eq(signals.source, "chain"));
    await tx.update(providers).set({ bondTotal: "0", bondLocked: "0", kycUntil: null }).where(eq(providers.registeredOnChain, true));
    await tx
      .insert(indexerCursor)
      .values({ name: CURSOR, blockNumber: 0, logIndex: -1 })
      .onConflictDoUpdate({ target: indexerCursor.name, set: { blockNumber: 0, logIndex: -1, updatedAt: new Date() } });
  });
}

function rpcUrl() {
  const id = Number(process.env.INDEXER_CHAIN_ID ?? process.env.CHAIN_ID ?? 133);
  if (id === 177) return process.env.HSK_RPC_URL ?? "https://mainnet.hsk.xyz";
  if (id === 31337) return process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545";
  return process.env.HSK_TESTNET_RPC_URL ?? "https://testnet.hsk.xyz";
}

/** Long-running loop: polls every second, projects events with enough confirmations. */
export async function runSync(opts: { reproject?: boolean; once?: boolean } = {}) {
  const confirmations = BigInt(process.env.INDEXER_CONFIRMATIONS ?? "1");
  const client = createPublicClient({ transport: http(rpcUrl()) });
  if (opts.reproject) {
    await resetProjections();
    console.log("projections reset; replaying raw events");
  }
  let stop = false;
  process.on("SIGINT", () => (stop = true));
  process.on("SIGTERM", () => (stop = true));
  while (!stop) {
    try {
      const head = await client.getBlockNumber();
      const n = await syncOnce(head - confirmations);
      if (n) console.log(`projected ${n} events`);
      if (opts.once) break;
    } catch (err) {
      // the raw table does not exist until Ponder has started once
      if (!/onchain_event.*does not exist/.test(String((err as Error).message))) console.error("sync error", err);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  await stopQueue();
  await closeDb();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runSync({ reproject: process.argv.includes("--reproject"), once: process.argv.includes("--once") }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
