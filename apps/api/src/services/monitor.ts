import { and, count, gte, inArray, lt, notInArray } from "drizzle-orm";
import { formatEther, getAddress } from "viem";
import { db } from "../db/client.js";
import { purchases, signals } from "../db/schema.js";
import { env } from "../env.js";
import { log } from "../lib/log.js";
import { publicClient } from "../chain/clients.js";
import { health } from "../routes/health.js";

/**
 * Status page + alerts (prompt 15, Part B.6). Each check is ok / failing with a one-line detail.
 * `monitorTick` runs every 5 minutes and sends a Telegram message to the team chat when a check flips.
 */
export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const SETTLE_GRACE_MS = 2 * 60 * 60_000;
const DONE = ["SETTLED", "REFUNDED"];

async function timed<T>(p: Promise<T>, ms = 3000): Promise<T> {
  return Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}

/** `STATUS_SERVICES=bot=https://bot.x/health,keeper=https://keeper.x/health` */
function services() {
  return (env().STATUS_SERVICES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const i = s.indexOf("=");
      return { name: s.slice(0, i), url: s.slice(i + 1) };
    });
}

export async function checks(now = new Date()): Promise<Check[]> {
  const e = env();
  const out: Check[] = [];
  const h = await health();
  out.push({ name: "api", ok: h.ok, detail: `db ${h.db.ok ? "up" : "down"}, rpc ${h.rpc.ok ? `block ${h.rpc.block}` : "down"}` });
  out.push({
    name: "relayer balance",
    ok: h.relayer.canSend,
    detail: h.relayer.configured ? `${h.relayer.balanceHsk ?? "?"} HSK (min ${h.relayer.minHsk})` : "relayer not configured",
  });

  if (e.KEEPER_ADDRESS) {
    const bal = await timed(publicClient().getBalance({ address: getAddress(e.KEEPER_ADDRESS) })).catch(() => null);
    out.push({
      name: "keeper balance",
      ok: bal != null && bal >= e.KEEPER_MIN_BALANCE_WEI,
      detail: `${bal == null ? "?" : formatEther(bal)} HSK (min ${formatEther(e.KEEPER_MIN_BALANCE_WEI)})`,
    });
  }

  for (const s of services()) {
    const r = await timed(fetch(s.url)).catch((err: Error) => err);
    out.push({ name: s.name, ok: !(r instanceof Error) && r.ok, detail: r instanceof Error ? r.message : `HTTP ${r.status}` });
  }

  const [late] = await db()
    .select({ n: count() })
    .from(signals)
    .where(and(lt(signals.validUntil, new Date(now.getTime() - SETTLE_GRACE_MS)), notInArray(signals.status, DONE)));
  out.push({ name: "settlements", ok: late!.n === 0, detail: `${late!.n} signal(s) expired > 2 h ago and not settled` });

  const [bad] = await db()
    .select({ n: count() })
    .from(purchases)
    .where(and(inArray(purchases.status, ["REJECTED", "FAILED_RETRYABLE"]), gte(purchases.updatedAt, new Date(now.getTime() - 60 * 60_000))));
  out.push({ name: "hsp verify", ok: bad!.n === 0, detail: `${bad!.n} rejected/retrying payment(s) in the last hour` });
  return out;
}

let failing = new Set<string>();

/** Sends one message per change (new failures and recoveries). Returns the message, if any. */
export async function monitorTick(send = sendTeamAlert): Promise<string | null> {
  const cs = await checks();
  const now = new Set(cs.filter((c) => !c.ok).map((c) => c.name));
  const lines = [
    ...cs.filter((c) => !c.ok && !failing.has(c.name)).map((c) => `🔴 ${c.name}: ${c.detail}`),
    ...cs.filter((c) => c.ok && failing.has(c.name)).map((c) => `🟢 ${c.name} recovered: ${c.detail}`),
  ];
  failing = now;
  if (!lines.length) return null;
  const msg = `Nundina (chain ${env().CHAIN_ID})\n${lines.join("\n")}`;
  await send(msg).catch((err) => log.error({ err }, "alert send failed"));
  return msg;
}

/** Test helper. */
export function resetMonitor() {
  failing = new Set();
}

async function sendTeamAlert(text: string) {
  const e = env();
  if (!e.TELEGRAM_BOT_TOKEN || !e.ALERT_TELEGRAM_CHAT_ID) {
    log.warn({ text }, "alert (no ALERT_TELEGRAM_CHAT_ID)");
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${e.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: e.ALERT_TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
  });
  if (!res.ok) throw new Error(`telegram sendMessage: HTTP ${res.status}`);
}
