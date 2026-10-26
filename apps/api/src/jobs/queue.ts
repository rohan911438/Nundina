import { PgBoss } from "pg-boss";
import { env } from "../env.js";
import { log } from "../lib/log.js";

/** Queue names shared with bot / keeper / agents. */
export const JOBS = {
  notifyLocked: "notify.locked",
  notifyResult: "notify.result",
  notifyKeyDelivered: "notify.keyDelivered",
  hspVerify: "hsp.verify",
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

export interface EnqueueOptions {
  /** Deduplicates: a second job with the same key is dropped while the first is queued. */
  singletonKey?: string;
  /** Delay in seconds, or an absolute time. */
  startAfter?: number | Date;
}

/** Enqueues a job. Never throws into request handlers. */
export async function enqueue(name: JobName, data: object, opts: EnqueueOptions | string = {}): Promise<string | null> {
  const o = typeof opts === "string" ? { singletonKey: opts } : opts;
  try {
    const b = await queue();
    return await b.send(name, data, {
      ...(o.singletonKey ? { singletonKey: o.singletonKey } : {}),
      ...(o.startAfter != null ? { startAfter: o.startAfter } : {}),
    });
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
