import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { env } from "./env.js";
import { authenticate } from "./auth/internal.js";
import type { AppEnv } from "./auth/context.js";
import { siweRoutes } from "./auth/siwe.js";
import { onError } from "./lib/errors.js";
import { log } from "./lib/log.js";
import { draftRoutes } from "./routes/drafts.js";
import { healthRoutes } from "./routes/health.js";
import { providerRoutes } from "./routes/providers.js";
import { publicRoutes } from "./routes/public.js";
import { purchaseRoutes } from "./routes/purchases.js";

/** Builds the Hono app (no server; `index.ts` serves it, tests call `app.request`). */
export function createApp() {
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          { error: { code: "bad_request", message: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") } },
          400,
        );
      }
    },
  });

  app.use("*", secureHeaders());
  app.use(
    "*",
    cors({
      origin: env().WEB_ORIGIN.split(",").map((s) => s.trim()),
      credentials: true,
      allowHeaders: ["content-type", "authorization", "x-telegram-init-data", "idempotency-key"],
    }),
  );
  app.use("*", async (c, next) => {
    const t = Date.now();
    await next();
    log.debug({ method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - t }, "req");
  });
  app.use("*", authenticate);
  app.onError(onError);
  app.notFound((c) => c.json({ error: { code: "not_found", message: "Route not found" } }, 404));

  app.route("/", healthRoutes);
  app.route("/auth", siweRoutes);
  app.route("/", publicRoutes);
  app.route("/", providerRoutes);
  app.route("/", draftRoutes);
  app.route("/", purchaseRoutes);

  app.doc31("/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "Nundina API",
      version: "0.1.0",
      description: "Public reads, auth, provider flows and the sponsored commit relayer.",
    },
    servers: [{ url: env().PUBLIC_API_URL }],
  });
  return app;
}
