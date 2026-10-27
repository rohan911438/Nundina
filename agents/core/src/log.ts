import type { Nundina } from "./nundina.js";

type Decision = "buy" | "skip" | "post" | "trade" | "route" | "error";

/** Every decision goes to the agent's activity log (and stdout); a logging failure never stops the agent. */
export function activityLog(api: Nundina, name: string) {
  return async (decision: Decision, reason: string, extra: { signalId?: string; purchaseId?: string; fill?: Record<string, unknown> } = {}) => {
    console.log(`[${new Date().toISOString()}] ${name} ${decision}${extra.signalId ? ` #${extra.signalId}` : ""}: ${reason}`);
    await api.activity({ decision, reason: reason.slice(0, 2000), ...extra }).catch((e) => console.warn(`${name}: activity log failed: ${(e as Error).message}`));
  };
}
export type ActivityLog = ReturnType<typeof activityLog>;
