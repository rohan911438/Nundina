import type { MiddlewareHandler } from "hono";
import { getAuth, type AppEnv } from "../auth/context.js";
import { env } from "../env.js";

/**
 * Fixed-window limiter in process memory (one API instance in production; put it behind Redis if that changes).
 * Keyed by user/agent when signed in, else by client IP. Internal calls (bot, keeper, agents) are not limited.
 */
const windows = new Map<string, { start: number; n: number }>();
const WINDOW_MS = 60_000;

function clientIp(h: (k: string) => string | undefined) {
  return h("cf-connecting-ip") ?? h("x-forwarded-for")?.split(",")[0]?.trim() ?? h("x-real-ip") ?? "local";
}

export const rateLimit: MiddlewareHandler<AppEnv> = async (c, next) => {
  const perMin = env().RATE_LIMIT_PER_MIN;
  const auth = getAuth(c);
  if (!perMin || auth.kind === "internal") return next();
  const strict = c.req.path.startsWith("/auth/") || c.req.path === "/me/api-keys";
  const limit = strict ? Math.max(1, Math.floor(perMin / 10)) : perMin;
  const who = auth.agentId ? `a${auth.agentId}` : auth.userId ? `u${auth.userId}` : `ip:${clientIp((k) => c.req.header(k))}`;
  const key = `${strict ? "s" : "g"}:${who}`;
  const now = Date.now();
  let w = windows.get(key);
  if (!w || now - w.start >= WINDOW_MS) windows.set(key, (w = { start: now, n: 0 }));
  w.n++;
  c.header("x-ratelimit-limit", String(limit));
  c.header("x-ratelimit-remaining", String(Math.max(0, limit - w.n)));
  if (w.n > limit) {
    c.header("retry-after", String(Math.ceil((w.start + WINDOW_MS - now) / 1000)));
    return c.json({ error: { code: "rate_limited", message: "Too many requests" } }, 429);
  }
  if (windows.size > 50_000) for (const [k, v] of windows) if (now - v.start >= WINDOW_MS) windows.delete(k);
  return next();
};
