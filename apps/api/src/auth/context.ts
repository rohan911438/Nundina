import type { Context, MiddlewareHandler } from "hono";
import { forbidden, unauthorized } from "../lib/errors.js";

export type AuthKind = "anon" | "session" | "telegram" | "apikey" | "internal";

export interface Auth {
  kind: AuthKind;
  userId?: number;
  wallet?: string;
  telegramId?: number;
  agentId?: number;
}

export type AppEnv = { Variables: { auth: Auth } };

export function getAuth(c: Context<AppEnv>): Auth {
  return c.get("auth") ?? { kind: "anon" };
}

/** Requires a signed-in user (wallet session, Telegram Mini App or API key). */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const a = getAuth(c);
  if (!a.userId) throw unauthorized();
  await next();
};

/** Requires the X-Internal-Secret header (bot, keeper, agents). */
export const requireInternal: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (getAuth(c).kind !== "internal") throw forbidden("Internal endpoint");
  await next();
};
