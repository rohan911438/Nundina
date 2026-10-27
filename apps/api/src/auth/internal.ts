import type { MiddlewareHandler } from "hono";
import { eq } from "drizzle-orm";
import { env } from "../env.js";
import { db } from "../db/client.js";
import { agents, users } from "../db/schema.js";
import { timingSafeEqualHex } from "../lib/crypto.js";
import { log } from "../lib/log.js";
import type { AppEnv, Auth } from "./context.js";
import { readSession } from "./siwe.js";
import { verifyInitData } from "./telegram.js";
import { resolveApiKey } from "./apiKey.js";

export const INTERNAL_HEADER = "x-internal-secret";
export const TELEGRAM_HEADER = "x-telegram-init-data";

/** Upserts a user by Telegram id. */
export async function userIdForTelegram(telegramId: number, username?: string): Promise<number> {
  const [row] = await db()
    .insert(users)
    .values({ telegramId, telegramUsername: username })
    .onConflictDoUpdate({ target: users.telegramId, set: { telegramUsername: username ?? null } })
    .returning({ id: users.id });
  return row!.id;
}

/**
 * Resolves who is calling. Precedence: internal secret > API key > Telegram initData > session cookie.
 * Internal callers may act for a user with `X-Act-As-User`.
 */
export const authenticate: MiddlewareHandler<AppEnv> = async (c, next) => {
  let auth: Auth = { kind: "anon" };
  const internal = c.req.header(INTERNAL_HEADER);
  const bearer = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  const initData = c.req.header(TELEGRAM_HEADER);

  if (internal) {
    if (timingSafeEqualHex(internal, env().INTERNAL_SECRET)) {
      auth = { kind: "internal" };
      const actAs = Number(c.req.header("x-act-as-user"));
      const actAsAgent = Number(c.req.header("x-act-as-agent"));
      if (actAsAgent) {
        // agent runtime: pays from the agent wallet, keys wrap to the agent's encryption key
        const ag = await db().query.agents.findFirst({ where: eq(agents.id, actAsAgent) });
        if (ag?.ownerUserId) auth = { kind: "internal", userId: ag.ownerUserId, agentId: ag.id, wallet: ag.wallet ?? undefined };
      } else if (actAs) {
        const u = await db().query.users.findFirst({ where: eq(users.id, actAs) });
        if (u) auth = { kind: "internal", userId: u.id, wallet: u.wallet ?? undefined, telegramId: u.telegramId ?? undefined };
      }
    } else {
      log.warn({ path: c.req.path }, "bad internal secret");
    }
  } else if (bearer?.startsWith("nk_")) {
    const k = await resolveApiKey(bearer);
    if (k?.ownerUserId) {
      const u = await db().query.users.findFirst({ where: eq(users.id, k.ownerUserId) });
      auth = { kind: "apikey", userId: k.ownerUserId, wallet: u?.wallet ?? undefined, agentId: k.agentId ?? undefined };
    }
  } else if (initData && env().TELEGRAM_BOT_TOKEN) {
    const d = verifyInitData(initData, env().TELEGRAM_BOT_TOKEN!);
    if (d?.user) {
      const userId = await userIdForTelegram(d.user.id, d.user.username);
      const u = await db().query.users.findFirst({ where: eq(users.id, userId) });
      auth = { kind: "telegram", userId, telegramId: d.user.id, wallet: u?.wallet ?? undefined };
    }
  } else {
    const s = await readSession(c);
    if (s) auth = { kind: "session", userId: s.userId, wallet: s.wallet };
  }
  c.set("auth", auth);
  await next();
};
