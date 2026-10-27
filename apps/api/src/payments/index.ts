import { env } from "../env.js";
import { HspGatewayRail } from "./HspGatewayRail.js";
import { HspRail } from "./HspRail.js";
import { MockRail } from "./MockRail.js";
import type { PaymentRail } from "./PaymentRail.js";

let rail: PaymentRail | undefined;

/**
 * The active rail: HSP_MODE=mock (default) or live. Live uses the HashKey Merchant gateway when its
 * app credentials are set, else the older Coordinator rail (HSP_COORDINATOR_URL).
 */
export function paymentRail(): PaymentRail {
  const e = env();
  rail ??= e.HSP_MODE !== "live" ? new MockRail() : e.HSP_MERCHANT_APP_KEY ? HspGatewayRail.fromEnv() : HspRail.fromEnv();
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
export { HspGatewayRail } from "./HspGatewayRail.js";
