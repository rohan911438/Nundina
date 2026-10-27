import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../auth/context.js";
import { db } from "../db/client.js";
import { purchases } from "../db/schema.js";
import { log } from "../lib/log.js";
import { verifyWebhook } from "../payments/hspGateway.js";
import { applyGatewayUpdate, gatewayRail, type GatewayUpdate } from "../payments/gatewaySync.js";

/**
 * HashKey Merchant gateway webhook (`webhook_url` in the merchant console → https://<api>/hsp/webhook).
 * Signed with the app secret (`X-Signature: t=…,v1=…`). It only nudges a purchase forward; the
 * verify job re-reads the gateway and checks the transfer on-chain before anything is credited.
 */
export const hspWebhookRoutes = new Hono<AppEnv>().post("/hsp/webhook", async (c) => {
  const rail = gatewayRail();
  if (!rail) return c.json({ error: { code: "not_enabled", message: "HSP gateway rail is not active" } }, 404);
  const raw = await c.req.text();
  const v = verifyWebhook(rail.appSecret, c.req.header("x-signature"), raw);
  if (!v.ok) {
    log.warn({ reason: v.reason }, "hsp webhook rejected");
    return c.json({ error: { code: "bad_signature", message: v.reason } }, 401);
  }
  let body: GatewayUpdate & { cart_mandate_id?: string; event_type?: string };
  try {
    body = JSON.parse(raw);
  } catch {
    return c.json({ error: { code: "bad_body", message: "invalid JSON" } }, 400);
  }
  const p = body.cart_mandate_id ? await db().query.purchases.findFirst({ where: eq(purchases.hspPaymentId, body.cart_mandate_id) }) : undefined;
  // 2xx for unknown orders too, so the gateway stops retrying something that isn't ours
  if (!p) return c.json({ ok: true, ignored: true });
  const u = await applyGatewayUpdate(p, body);
  log.info({ purchaseId: p.id, gatewayStatus: body.status, status: u.status }, "hsp webhook");
  return c.json({ ok: true, status: u.status });
});
