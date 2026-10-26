import { log } from "../lib/log.js";
import { processVerify } from "./hspRetry.js";
import { queue, JOBS } from "./queue.js";
import { revealSignal } from "./reveal.js";

/** Starts the API's own job handlers. Notify jobs are consumed by the bot (prompt 09). */
export async function startWorkers() {
  const b = await queue();
  await b.work<{ purchaseId: string; attempt?: number }>(JOBS.hspVerify, async (jobs) => {
    for (const j of jobs) {
      const r = await processVerify(j.data.purchaseId, j.data.attempt ?? 0);
      log.info({ purchaseId: j.data.purchaseId, result: r.status }, "hsp.verify");
    }
  });
  await b.work<{ signalId: string }>(JOBS.reveal, async (jobs) => {
    for (const j of jobs) await revealSignal(BigInt(j.data.signalId));
  });
  log.info("job workers started");
}
