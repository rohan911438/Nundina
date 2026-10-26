import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { closeDb } from "./db/client.js";
import { env } from "./env.js";
import { queue, stopQueue } from "./jobs/queue.js";
import { startWorkers } from "./jobs/workers.js";
import { initPaymentRail } from "./payments/index.js";
import { log } from "./lib/log.js";

const app = createApp();
const { PORT, RUN_WORKERS } = env();

const server = serve({ fetch: app.fetch, port: PORT }, (info) => log.info(`api listening on :${info.port}`));
(RUN_WORKERS ? startWorkers() : queue()).catch((err) => log.error({ err }, "job queue failed to start"));
initPaymentRail().catch((err) => {
  log.fatal({ err }, "payment rail init failed");
  process.exit(1);
});

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log.info({ signal }, "shutting down");
  server.close();
  await stopQueue().catch(() => {});
  await closeDb().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
