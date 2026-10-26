/** pg-boss queue names shared by the API, indexer, bot, keeper and agents. */
export const JOBS = {
  notifyLocked: "notify.locked",
  notifyResult: "notify.result",
  notifyKeyDelivered: "notify.keyDelivered",
  notifyRevealReminder: "notify.revealReminder",
  hspVerify: "hsp.verify",
  reveal: "signal.reveal",
  score: "score.recompute",
} as const;
export type JobName = (typeof JOBS)[keyof typeof JOBS];

/** Job payloads (ids as strings: pg-boss stores JSON). */
export interface JobData {
  "notify.locked": { signalId: string; providerId: number };
  "notify.result": { signalId: string; outcome: string };
  "notify.keyDelivered": { purchaseId: string; signalId: string };
  "notify.revealReminder": { signalId: string };
}
