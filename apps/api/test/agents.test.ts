import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createSiweMessage } from "viem/siwe";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { closeDb, db } from "../src/db/client.js";
import { agents, users } from "../src/db/schema.js";
import { signInitData } from "../src/auth/telegram.js";
import { userIdForTelegram } from "../src/auth/internal.js";
import { app, getJson, INTERNAL, postJson } from "./helpers.js";

afterAll(closeDb);

const TOKEN = "123456:TEST_TOKEN";

async function login(headers: Record<string, string> = {}) {
  const account = privateKeyToAccount(generatePrivateKey());
  const { body } = await getJson("/auth/nonce");
  const message = createSiweMessage({ address: account.address, chainId: 31337, domain: "localhost", nonce: body.nonce, uri: "http://localhost:3000", version: "1" });
  const r = await postJson("/auth/verify", { message, signature: await account.signMessage({ message }) }, headers);
  return { r, cookie: (r.res.headers.get("set-cookie") ?? "").split(";")[0]!, account };
}

async function req(method: string, path: string, headers: Record<string, string>, body?: unknown) {
  const res = await app.request(path, { method, headers: { "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: (await res.json()) as any };
}

describe("Telegram ↔ wallet linking on SIWE", () => {
  it("moves the Telegram id from the bot-created row onto the wallet user", async () => {
    const tgId = 700_000 + Math.floor(Math.random() * 100_000);
    const botRow = await userIdForTelegram(tgId, "tester");
    const initData = signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: tgId, username: "tester" }) }, TOKEN);
    const { r } = await login({ "x-telegram-init-data": initData });
    expect(r.status).toBe(200);
    const walletUser = await db().query.users.findFirst({ where: eq(users.id, r.body.userId) });
    expect(walletUser?.telegramId).toBe(tgId);
    const old = await db().query.users.findFirst({ where: eq(users.id, botRow) });
    expect(old?.telegramId).toBeNull();

    // Mini App calls with initData now resolve to the wallet user
    const me = await getJson("/me/subscriber", { "x-telegram-init-data": initData });
    expect(me.status).toBe(200);
    expect(me.body.wallet).toBe(walletUser!.wallet);
  });

  it("refuses to steal a Telegram id that is linked to another wallet", async () => {
    const tgId = 800_000 + Math.floor(Math.random() * 100_000);
    const initData = signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: tgId }) }, TOKEN);
    expect((await login({ "x-telegram-init-data": initData })).r.status).toBe(200);
    const second = await login({ "x-telegram-init-data": initData });
    expect(second.r.status).toBe(400);
    expect(second.r.body.error.code).toBe("telegram_linked");
  });
});

describe("/agents", () => {
  it("creates an agent with its own wallet and a one-time API key; owner manages policy, pause, activity", async () => {
    const { cookie } = await login();
    const h = { cookie };
    const created = await req("POST", "/agents", h, { name: "My bot", policy: { dailyBudgetUsd: "5", maxPerSignalUsd: "0.5", minScore: 60, markets: ["BTC/USD"] } });
    expect(created.status).toBe(201);
    const { agent, apiKey } = created.body;
    expect(apiKey).toMatch(/^nk_/);
    expect(agent.wallet).toMatch(/^0x[0-9a-f]{40}$/);
    expect(agent.policy).toMatchObject({ dailyBudgetUsd: "5", maxPerSignalUsd: "0.5", minScore: 60, markets: ["BTC/USD"] });
    expect(JSON.stringify(created.body)).not.toMatch(/walletKey|encKey/);

    const listed = await req("GET", "/agents", h);
    expect(listed.body.items.map((a: any) => a.id)).toContain(agent.id);

    const patched = await req("PATCH", `/agents/${agent.id}/policy`, h, { minScore: 70, autoTrade: true, slippageBps: 30 });
    expect(patched.body.policy).toMatchObject({ minScore: 70, autoTrade: true, slippageBps: 30, dailyBudgetUsd: "5" });

    // the agent's own key logs activity and can pause itself, but cannot resume or change policy
    const ak = { authorization: `Bearer ${apiKey}` };
    expect((await req("POST", `/agents/${agent.id}/activity`, ak, { decision: "skip", reason: "score 41 < 70", signalId: "12" })).status).toBe(201);
    expect((await req("PATCH", `/agents/${agent.id}/policy`, ak, { minScore: 0 })).status).toBe(403);
    expect((await req("POST", `/agents/${agent.id}/pause`, ak, { paused: true })).body.paused).toBe(true);
    expect((await req("POST", `/agents/${agent.id}/pause`, ak, { paused: false })).status).toBe(403);
    expect((await req("POST", `/agents/${agent.id}/pause`, h, { paused: false })).body.paused).toBe(false);

    const act = await req("GET", `/agents/${agent.id}/activity`, h);
    expect(act.body.items[0]).toMatchObject({ decision: "skip", reason: "score 41 < 70", signalId: "12" });

    // secrets only over the internal channel, and they match the public wallet
    expect((await req("GET", `/internal/agents/${agent.id}/secrets`, h)).status).toBe(403);
    const sec = await req("GET", `/internal/agents/${agent.id}/secrets`, INTERNAL);
    expect(privateKeyToAccount(sec.body.walletKey).address.toLowerCase()).toBe(agent.wallet);
  });

  it("hides other users' agents", async () => {
    const a = await login();
    const b = await login();
    const created = await req("POST", "/agents", { cookie: a.cookie }, {});
    expect((await req("GET", `/agents/${created.body.agent.id}`, { cookie: b.cookie })).status).toBe(403);
    expect((await req("GET", "/agents", {})).status).toBe(401);
  });
});

describe("internal agent runtime routes", () => {
  it("registers our own provider agent idempotently, acts as it, and tracks spend by UTC day", async () => {
    const wallet = privateKeyToAccount(generatePrivateKey()).address;
    const handle = `bot_${Date.now() % 1_000_000}`;
    const body = { name: `strat-${handle}`, type: "strategy", wallet, provider: { handle, displayName: "Bot", defaultPriceUsd: "0.25" } };
    const a = await req("POST", "/internal/agents/register", INTERNAL, body);
    expect(a.status).toBe(201);
    expect(a.body.providerId).toBeGreaterThan(0);
    const again = await req("POST", "/internal/agents/register", INTERNAL, body);
    expect(again.status).toBe(200);
    expect(again.body.agent.id).toBe(a.body.agent.id);
    expect(again.body.providerId).toBe(a.body.providerId);
    expect((await getJson(`/providers/${handle}`)).body.kind).toBe("agent");

    // act as the agent: the agent row's owner and wallet
    const asAgent = { ...INTERNAL, "x-act-as-agent": String(a.body.agent.id) };
    const me = await req("GET", `/agents/${a.body.agent.id}`, asAgent);
    expect(me.body.wallet).toBe(wallet.toLowerCase());
    const d = await req("POST", "/drafts", asAgent, { rawText: "BTC LONG", parser: "agent" });
    expect(d.status).toBe(201);
    const secrets = await req("GET", `/internal/agents/${a.body.agent.id}/secrets`, INTERNAL);
    expect(secrets.body.encKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(secrets.body.walletKey).toBeNull(); // our agents keep their wallet key in env

    // spend counter
    const s1 = await req("POST", `/internal/agents/${a.body.agent.id}/spend`, INTERNAL, { amount: "300000" });
    const s2 = await req("POST", `/internal/agents/${a.body.agent.id}/spend`, INTERNAL, { amount: "200000" });
    expect(s1.body.spentTodayUsd).toBe("0.3");
    expect(s2.body.spentTodayUsd).toBe("0.5");
    await db().update(agents).set({ spentDay: "2000-01-01" }).where(eq(agents.id, a.body.agent.id));
    expect((await req("GET", `/agents/${a.body.agent.id}`, asAgent)).body.spentTodayUsd).toBe("0");
    const s3 = await req("POST", `/internal/agents/${a.body.agent.id}/spend`, INTERNAL, { amount: "100000" });
    expect(s3.body.spentTodayUsd).toBe("0.1");

    // logs a route decision; refuses without the internal secret
    expect((await req("POST", `/agents/${a.body.agent.id}/activity`, asAgent, { decision: "route", reason: "WIN routed" })).status).toBe(201);
    expect((await req("POST", "/internal/agents/register", {}, body)).status).toBe(403);
  });
});
