import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../src/db/client.js";
import { seed } from "../src/db/seed.js";
import { signals } from "../src/db/schema.js";
import { getJson } from "./helpers.js";

beforeAll(async () => {
  await seed();
});
afterAll(closeDb);

describe("public reads", () => {
  it("/stats totals", async () => {
    const r = await getJson("/stats");
    expect(r.status).toBe(200);
    expect(r.body.signalsSettled).toBeGreaterThanOrEqual(60);
    expect(r.body.providers).toBeGreaterThanOrEqual(5);
  });

  it("/providers paginates with a cursor without duplicates", async () => {
    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    do {
      const r = await getJson(`/providers?period=all&limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      expect(r.status).toBe(200);
      expect(r.body.items.length).toBeLessThanOrEqual(2);
      for (const p of r.body.items) {
        expect(seen.has(p.handle)).toBe(false);
        seen.add(p.handle);
      }
      cursor = r.body.nextCursor;
      pages++;
    } while (cursor && pages < 20);
    expect(seen.size).toBeGreaterThanOrEqual(5);
  });

  it("/providers flags probation when n < 30", async () => {
    const r = await getJson("/providers?period=all&limit=50");
    for (const p of r.body.items) expect(p.score.probation).toBe(p.score.n < 30);
    expect(r.body.items.some((p: { score: { probation: boolean } }) => p.score.probation)).toBe(true);
  });

  it("/providers filters by type and includes observed profiles on request", async () => {
    const agents = await getJson("/providers?type=agent&limit=50");
    expect(agents.body.items.every((p: { kind: string }) => p.kind === "agent")).toBe(true);
    const without = await getJson("/providers?limit=50");
    expect(without.body.items.some((p: { observed: boolean }) => p.observed)).toBe(false);
    const withObs = await getJson("/providers?observed=true&limit=50");
    expect(withObs.body.items.some((p: { observed: boolean }) => p.observed)).toBe(true);
  });

  it("/providers rejects a bad query", async () => {
    expect((await getJson("/providers?period=1y")).status).toBe(400);
  });

  it("/providers/:handle and its signals", async () => {
    const p = await getJson("/providers/satoshi_signals");
    expect(p.status).toBe(200);
    expect(p.body.scores.length).toBeGreaterThan(0);
    const s = await getJson("/providers/satoshi_signals/signals?limit=5");
    expect(s.body.items).toHaveLength(5);
    expect((await getJson("/providers/nobody_here")).status).toBe(404);
  });

  it("/signals/:id never leaks plaintext before reveal", async () => {
    const [live] = await db().select().from(signals).where(eq(signals.status, "COMMITTED")).limit(1);
    // even if plaintext columns were filled (e.g. by the indexer), the API must hide them
    await db()
      .update(signals)
      .set({ side: 0, entry: "8150012345678", tp: "8300000000000", sl: "8000000000000" })
      .where(eq(signals.id, live!.id));
    const r = await getJson(`/signals/${live!.id}`);
    expect(r.status).toBe(200);
    expect(r.body.revealed).toBe(false);
    expect(r.body.side).toBeNull();
    expect(r.body.entry).toBeNull();
    expect(r.body.takeProfit).toBeNull();
    expect(r.body.stopLoss).toBeNull();
    const raw = JSON.stringify(r.body);
    expect(raw).not.toMatch(/ciphertext|aesKey|salt/i);
    expect(raw).not.toContain("81500.12");

    const feed = await getJson("/signals?status=COMMITTED&limit=50");
    for (const s of feed.body.items) expect(s.entry).toBeNull();
  });

  it("/signals/:id shows plaintext, settlement and upstream tree once settled", async () => {
    const [settled] = await db().select().from(signals).where(eq(signals.status, "SETTLED")).limit(1);
    const r = await getJson(`/signals/${settled!.id}`);
    expect(r.body.revealed).toBe(true);
    expect(r.body.entry).not.toBeNull();
    expect(r.body.settlement).not.toBeNull();
    const withUp = (await getJson("/signals?limit=100")).body.items.find(
      (s: { upstream: unknown[] }) => s.upstream.length,
    );
    const d = await getJson(`/signals/${withUp.id}`);
    expect(d.body.upstreamTree.length).toBeGreaterThan(0);
  });

  it("/signals keyset pagination", async () => {
    const a = await getJson("/signals?limit=10");
    const b = await getJson(`/signals?limit=10&cursor=${a.body.nextCursor}`);
    expect(BigInt(b.body.items[0].id)).toBeLessThan(BigInt(a.body.items[9].id));
  });

  it("/contracts and /openapi.json", async () => {
    const c = await getJson("/contracts");
    expect(c.body.chainId).toBe(31337);
    expect(c.body.abis.SignalBook.length).toBeGreaterThan(0);
    const o = await getJson("/openapi.json");
    expect(o.body.paths["/providers"]).toBeDefined();
    expect(o.body.paths["/signals/{id}"]).toBeDefined();
  });
});
