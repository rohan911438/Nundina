import { Hono } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { and, eq, gt, isNull } from "drizzle-orm";
import { generateSiweNonce, parseSiweMessage } from "viem/siwe";
import { verifyMessage, getAddress, type Hex } from "viem";
import { z } from "zod";
import { db } from "../db/client.js";
import { authNonces, users } from "../db/schema.js";
import { env, sessionSecret } from "../env.js";
import { publicClient } from "../chain/clients.js";
import { badRequest, unauthorized } from "../lib/errors.js";
import type { AppEnv } from "./context.js";
import { verifyInitData } from "./telegram.js";
import { bindTelegram } from "../services/telegramAccount.js";
import type { Context } from "hono";

export const SESSION_COOKIE = "nd_session";
const SESSION_TTL_S = 7 * 24 * 3600;
const NONCE_TTL_MS = 10 * 60 * 1000;

export interface SessionPayload {
  userId: number;
  wallet: string;
  exp: number;
}

export async function readSession(c: Context): Promise<SessionPayload | undefined> {
  const raw = await getSignedCookie(c, sessionSecret(), SESSION_COOKIE);
  if (!raw) return undefined;
  try {
    const p = JSON.parse(raw) as SessionPayload;
    return p.exp > Date.now() / 1000 ? p : undefined;
  } catch {
    return undefined;
  }
}

/** Upserts a user by wallet and returns its id. */
export async function userIdForWallet(wallet: string): Promise<number> {
  const w = wallet.toLowerCase();
  const [row] = await db()
    .insert(users)
    .values({ wallet: w })
    .onConflictDoUpdate({ target: users.wallet, set: { wallet: w } })
    .returning({ id: users.id });
  return row!.id;
}

/**
 * Inside the Mini App the client also sends initData: move the Telegram id onto the wallet user so
 * bot DMs and Mini App calls resolve to the same account. A Telegram-only row (created by the bot)
 * gives up its id; a wallet-holding row keeps it (one Telegram account, one wallet).
 */
async function linkTelegram(c: Context, userId: number) {
  const initData = c.req.header("x-telegram-init-data");
  const token = env().TELEGRAM_BOT_TOKEN;
  if (!initData || !token) return;
  const d = verifyInitData(initData, token);
  if (!d?.user) return;
  await bindTelegram(userId, d.user.id, d.user.username);
}

/** SIWE `domain` (host[:port]) whose hostname is one of WEB_ORIGIN's; the port doesn't matter. */
function allowedDomain(domain: string | undefined): boolean {
  if (!domain) return false;
  const host = (s: string) => {
    try {
      return new URL(s.includes("://") ? s : `http://${s}`).hostname.toLowerCase();
    } catch {
      return null;
    }
  };
  const d = host(domain);
  return d != null && env().WEB_ORIGIN.split(",").some((o) => host(o.trim()) === d);
}

const VerifyBody =z.object({ message: z.string().min(10), signature: z.string().regex(/^0x[0-9a-fA-F]+$/) });

export const siweRoutes = new Hono<AppEnv>()
  .get("/nonce", async (c) => {
    const nonce = generateSiweNonce();
    await db()
      .insert(authNonces)
      .values({ nonce, expiresAt: new Date(Date.now() + NONCE_TTL_MS) });
    return c.json({ nonce });
  })
  .post("/verify", async (c) => {
    const body = VerifyBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw badRequest("bad_body", "message and signature required");
    const { message, signature } = body.data;
    const parsed = parseSiweMessage(message);
    if (!parsed.address || !parsed.nonce) throw badRequest("bad_message", "Not a SIWE message");
    if (parsed.chainId !== env().CHAIN_ID) throw badRequest("wrong_chain", `Sign in on chain ${env().CHAIN_ID}`);
    if (parsed.expirationTime && parsed.expirationTime.getTime() < Date.now()) throw unauthorized("Message expired");
    // EIP-4361: the message must name our site, or a phishing page could fetch our nonce, have the
    // wallet sign for its own domain and trade that signature for a session on the victim's wallet
    if (!allowedDomain(parsed.domain)) throw unauthorized("Sign-in message is for a different site");

    // single-use nonce
    const used = await db()
      .update(authNonces)
      .set({ usedAt: new Date() })
      .where(and(eq(authNonces.nonce, parsed.nonce), isNull(authNonces.usedAt), gt(authNonces.expiresAt, new Date())))
      .returning();
    if (used.length === 0) throw unauthorized("Nonce invalid or already used");

    const address = getAddress(parsed.address);
    let ok = await verifyMessage({ address, message, signature: signature as Hex }).catch(() => false);
    if (!ok) {
      // smart-contract wallets (ERC-1271 / ERC-6492)
      ok = await publicClient()
        .verifyMessage({ address, message, signature: signature as Hex })
        .catch(() => false);
    }
    if (!ok) throw unauthorized("Bad signature");

    const userId = await userIdForWallet(address);
    await linkTelegram(c, userId);
    const payload: SessionPayload = { userId, wallet: address.toLowerCase(), exp: Math.floor(Date.now() / 1000) + SESSION_TTL_S };
    await setSignedCookie(c, SESSION_COOKIE, JSON.stringify(payload), sessionSecret(), {
      httpOnly: true,
      sameSite: "Lax",
      secure: env().NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_TTL_S,
    });
    return c.json({ userId, wallet: payload.wallet });
  })
  .post("/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  })
  .get("/me", async (c) => {
    const s = await readSession(c);
    if (!s) return c.json({ userId: null, wallet: null, telegram: null });
    const u = await db().query.users.findFirst({ where: eq(users.id, s.userId) });
    const telegram = u?.telegramId ? { username: u.telegramUsername ?? null } : null;
    return c.json({ userId: s.userId, wallet: s.wallet, telegram });
  });
