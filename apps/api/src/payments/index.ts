import { env } from "../env.js";
import { HspRail } from "./HspRail.js";
import { MockRail } from "./MockRail.js";
import type { PaymentRail } from "./PaymentRail.js";

let rail: PaymentRail | undefined;

/** The active rail: HSP_MODE=mock (default) or live. */
export function paymentRail(): PaymentRail {
  rail ??= env().HSP_MODE === "live" ? HspRail.fromEnv() : new MockRail();
  return rail;
}

/** Test hook. */
export function setPaymentRail(r: PaymentRail | undefined) {
  rail = r;
}

/** Called at boot in live mode so a wrong adapter pin fails fast. */
export async function initPaymentRail() {
  const r = paymentRail();
  if (r instanceof HspRail) await r.pinAdapter();
}

export * from "./PaymentRail.js";
