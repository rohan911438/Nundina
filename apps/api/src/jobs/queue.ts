import { PgBoss } from "pg-boss";
import { env } from "../env.js";
import { log } from "../lib/log.js";

/** Queue names shared with bot / keeper / agents. */
export const JOBS = {
  notifyLocked: "notify.locked",
  notifyResult: "notify.result",
  reveal: "signal.reveal",
  score: "score.recompute",
} as const;
export type JobName = (typeof JOBS)[keyof typeof JOBS];

let boss: PgBoss | undefined;
let starting: Promise<PgBoss> | undefined;

/** Starts pg-boss once (Postgres-backed, no Redis) and creates every queue. */
export function queue(): Promise<PgBoss> {
  if (boss) return Promise.resolve(boss);
  starting ??= (async () => {
    const b = new PgBoss({ connectionString: env().DATABASE_URL, schema: "pgboss" });
    b.on("error", (err) => log.error({ err }, "pg-boss error"));
    await b.start();
    for (const name of Object.values(JOBS)) await b.createQueue(name);
    boss = b;
    return b;
  })();
  return starting;
}

/** Enqueues a job; idempotent when `singletonKey` is set. Never throws into request handlers. */
export async function enqueue(name: JobName, data: object, singletonKey?: string): Promise<string | null> {
  try {
    const b = await queue();
    return await b.send(name, data, singletonKey ? { singletonKey } : {});
  } catch (err) {
    log.error({ err, name }, "enqueue failed");
    return null;
  }
}

export async function stopQueue() {
  await boss?.stop({ graceful: true, timeout: 5_000 });
  boss = undefined;
  starting = undefined;
}
