import { index, onchainTable } from "ponder";

/**
 * Raw events, one row per log. Ponder owns this table (reorgs roll it back); `src/sync.ts`
 * projects it into the API tables and can rebuild them from scratch (`pnpm reproject`).
 */
export const onchainEvent = onchainTable(
  "onchain_event",
  (t) => ({
    /** `${txHash}-${logIndex}` */
    id: t.text().primaryKey(),
    chainId: t.integer().notNull(),
    blockNumber: t.bigint().notNull(),
    blockTimestamp: t.bigint().notNull(),
    txHash: t.hex().notNull(),
    logIndex: t.integer().notNull(),
    contract: t.text().notNull(),
    event: t.text().notNull(),
    /** Decoded args, bigints as strings. */
    args: t.json().notNull(),
  }),
  (t) => ({
    orderIdx: index().on(t.blockNumber, t.logIndex),
    eventIdx: index().on(t.event),
  }),
);
