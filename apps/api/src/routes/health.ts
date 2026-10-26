import { Hono } from "hono";
import { formatEther } from "viem";
import { isDeployed } from "@nundina/shared";
import { sql } from "../db/client.js";
import { env } from "../env.js";
import { publicClient, relayerAccount } from "../chain/clients.js";
import { relayerBalance } from "../chain/relayer.js";
import type { AppEnv } from "../auth/context.js";

const withTimeout = <T>(p: Promise<T>, ms = 3000) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

/** Liveness + dependencies: DB, RPC, relayer balance vs threshold. 503 if DB or RPC is down. */
export async function health() {
  const e = env();
  const [dbr, rpc, bal] = await Promise.allSettled([
    withTimeout(sql()`select 1`),
    withTimeout(publicClient().getBlockNumber()),
    withTimeout(relayerBalance()),
  ]);
  const balance = bal.status === "fulfilled" ? bal.value : null;
  const relayer = relayerAccount();
  const relayerOk = balance != null && balance >= e.RELAYER_MIN_BALANCE_WEI;
  const ok = dbr.status === "fulfilled" && rpc.status === "fulfilled";
  return {
    ok,
    chainId: e.CHAIN_ID,
    contractsDeployed: isDeployed(e.CHAIN_ID),
    db: { ok: dbr.status === "fulfilled" },
    rpc: {
      ok: rpc.status === "fulfilled",
      block: rpc.status === "fulfilled" ? rpc.value.toString() : null,
      error: rpc.status === "rejected" ? String(rpc.reason?.message ?? rpc.reason) : undefined,
    },
    relayer: {
      configured: Boolean(relayer),
      address: relayer?.address ?? null,
      balanceHsk: balance == null ? null : formatEther(balance),
      minHsk: formatEther(e.RELAYER_MIN_BALANCE_WEI),
      canSend: relayerOk,
    },
  };
}

export const healthRoutes = new Hono<AppEnv>().get("/health", async (c) => {
  const h = await health();
  return c.json(h, h.ok ? 200 : 503);
});
