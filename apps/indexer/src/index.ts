import { ponder } from "ponder:registry";
import { onchainEvent } from "ponder:schema";
import { replaceBigInts } from "ponder";
import { INDEXED_EVENTS } from "./events.js";

type AnyEvent = {
  args: Record<string, unknown>;
  log: { logIndex: number };
  block: { number: bigint; timestamp: bigint };
  transaction: { hash: `0x${string}` };
};
type AnyContext = { chain: { id: number }; db: { insert: (t: typeof onchainEvent) => any } };

// Every indexed event is stored raw; projection into API tables happens in projector/sync.ts.
for (const [contract, events] of Object.entries(INDEXED_EVENTS)) {
  for (const name of events) {
    (ponder.on as (key: string, fn: (a: { event: AnyEvent; context: AnyContext }) => Promise<void>) => void)(
      `${contract}:${name}`,
      async ({ event, context }) => {
        await context.db
          .insert(onchainEvent)
          .values({
            id: `${event.transaction.hash}-${event.log.logIndex}`,
            chainId: context.chain.id,
            blockNumber: event.block.number,
            blockTimestamp: event.block.timestamp,
            txHash: event.transaction.hash,
            logIndex: event.log.logIndex,
            contract,
            event: name,
            args: replaceBigInts(event.args, (v) => String(v)),
          })
          .onConflictDoNothing();
      },
    );
  }
}
