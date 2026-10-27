import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { resetEnv } from "../src/env.js";

describe("rate limit (prompt 15)", () => {
  afterAll(() => {
    delete process.env.RATE_LIMIT_PER_MIN;
    resetEnv();
  });

  it("429s an IP over the limit, auth endpoints at a tenth, internal calls never", async () => {
    process.env.RATE_LIMIT_PER_MIN = "20";
    resetEnv();
    const app = createApp();
    const from = (ip: string, extra: Record<string, string> = {}) => ({ headers: { "x-forwarded-for": ip, ...extra } });
    const codes: number[] = [];
    for (let i = 0; i < 21; i++) codes.push((await app.request("/health", from("10.0.0.1"))).status);
    expect(codes.slice(0, 20).every((s) => s !== 429)).toBe(true);
    const last = await app.request("/health", from("10.0.0.1"));
    expect(last.status).toBe(429);
    expect(last.headers.get("retry-after")).toBeTruthy();
    expect((await app.request("/health", from("10.0.0.2"))).status).not.toBe(429);

    const auth: number[] = [];
    for (let i = 0; i < 3; i++) auth.push((await app.request("/auth/nonce", from("10.0.0.3"))).status);
    expect(auth[2]).toBe(429);

    const internal = { "x-internal-secret": process.env.INTERNAL_SECRET! };
    for (let i = 0; i < 25; i++) expect((await app.request("/health", from("10.0.0.4", internal))).status).not.toBe(429);
  });
});
