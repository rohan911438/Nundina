import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { closeDb } from "../src/db/client.js";
import { checks, monitorTick, resetMonitor } from "../src/services/monitor.js";

afterAll(() => closeDb());

describe("monitoring (prompt 15)", () => {
  it("/status lists every check", async () => {
    const res = await createApp().request("/status");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { checks: { name: string }[] };
    expect(body.checks.map((c) => c.name)).toEqual(expect.arrayContaining(["api", "relayer balance", "settlements", "hsp verify"]));
  });

  it("alerts once per change, not every tick", async () => {
    resetMonitor();
    const sent: string[] = [];
    const send = async (m: string) => void sent.push(m);
    const failing = (await checks()).filter((c) => !c.ok).length;
    await monitorTick(send);
    await monitorTick(send);
    expect(sent.length).toBe(failing ? 1 : 0);
    if (failing) expect(sent[0]).toMatch(/🔴/);
  });
});
