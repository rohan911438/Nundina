import { afterAll, describe, expect, it } from "vitest";
import { createSiweMessage } from "viem/siwe";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { closeDb } from "../src/db/client.js";
import { signInitData, verifyInitData } from "../src/auth/telegram.js";
import { app, getJson, postJson } from "./helpers.js";

afterAll(closeDb);

async function siweLogin() {
  const account = privateKeyToAccount(generatePrivateKey());
  const { body } = await getJson("/auth/nonce");
  const message = createSiweMessage({
    address: account.address,
    chainId: 31337,
    domain: "localhost",
    nonce: body.nonce,
    uri: "http://localhost:3000",
    version: "1",
    statement: "Sign in to Nundina",
  });
  const signature = await account.signMessage({ message });
  return { account, message, signature };
}

describe("SIWE", () => {
  it("signs in, sets an httpOnly session cookie, and /auth/me sees it", async () => {
    const { account, message, signature } = await siweLogin();
    const r = await postJson("/auth/verify", { message, signature });
    expect(r.status).toBe(200);
    expect(r.body.wallet).toBe(account.address.toLowerCase());
    const cookie = r.res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/nd_session=/);
    expect(cookie).toMatch(/HttpOnly/i);

    const me = await getJson("/auth/me", { cookie: cookie.split(";")[0]! });
    expect(me.body.userId).toBe(r.body.userId);
  });

  it("rejects a replayed nonce", async () => {
    const { message, signature } = await siweLogin();
    expect((await postJson("/auth/verify", { message, signature })).status).toBe(200);
    const again = await postJson("/auth/verify", { message, signature });
    expect(again.status).toBe(401);
    expect(again.body.error.message).toMatch(/nonce/i);
  });

  it("rejects a signature from another wallet", async () => {
    const { message } = await siweLogin();
    const other = privateKeyToAccount(generatePrivateKey());
    const r = await postJson("/auth/verify", { message, signature: await other.signMessage({ message }) });
    expect(r.status).toBe(401);
  });

  it("rejects the wrong chain", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const { body } = await getJson("/auth/nonce");
    const message = createSiweMessage({
      address: account.address,
      chainId: 1,
      domain: "localhost",
      nonce: body.nonce,
      uri: "http://localhost:3000",
      version: "1",
    });
    const r = await postJson("/auth/verify", { message, signature: await account.signMessage({ message }) });
    expect(r.status).toBe(400);
  });
});

describe("Telegram initData", () => {
  const token = "123456:TEST_TOKEN";
  const now = Math.floor(Date.now() / 1000);
  const user = JSON.stringify({ id: 4242, username: "tester" });

  it("accepts valid data", () => {
    const raw = signInitData({ auth_date: String(now), user, query_id: "q1" }, token);
    expect(verifyInitData(raw, token)?.user?.id).toBe(4242);
  });

  it("rejects tampered data", () => {
    const raw = signInitData({ auth_date: String(now), user }, token);
    expect(verifyInitData(raw.replace("4242", "4243"), token)).toBeNull();
  });

  it("rejects data older than 1 hour", () => {
    const raw = signInitData({ auth_date: String(now - 3601), user }, token);
    expect(verifyInitData(raw, token)).toBeNull();
  });

  it("rejects data signed with another bot token", () => {
    const raw = signInitData({ auth_date: String(now), user }, "999:OTHER");
    expect(verifyInitData(raw, token)).toBeNull();
  });

  it("authenticates requests via X-Telegram-Init-Data", async () => {
    const raw = signInitData({ auth_date: String(now), user }, token);
    const res = await app.request("/me/provider", { headers: { "x-telegram-init-data": raw } });
    expect(res.status).toBe(404); // signed in, but no provider profile yet
    expect((await app.request("/me/provider")).status).toBe(401);
  });
});

describe("internal secret", () => {
  it("guards internal routes", async () => {
    const r = await postJson(
      "/providers/link-telegram",
      { code: "XXXXXX", channelId: 1 },
      { "x-internal-secret": "wrong-secret-wrong-secret" },
    );
    expect(r.status).toBe(403);
  });
});
