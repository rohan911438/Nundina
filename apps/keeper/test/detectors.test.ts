import { describe, expect, it } from "vitest";
import { MARKETS, Side, toPrice, type Signal } from "@nundina/shared";
import { checkBucket, checkTick, ENTRY, SL, TP, type WatchedSignal } from "../src/detectors/touch.js";
import { PriceHistory } from "../src/history.js";
import { SupraProofClient } from "../src/proofs/supra.js";

const P = (v: string) => toPrice(v);

function watched(side: Side, entry: string, tp: string, sl: string, opts: Partial<WatchedSignal> = {}): WatchedSignal {
  const s: Signal = {
    provider: "0x0000000000000000000000000000000000000001",
    market: MARKETS["BTC/USD"].id,
    side,
    entry: P(entry),
    takeProfit: P(tp),
    stopLoss: P(sl),
    validUntil: 2000n,
    pricePerSub: 0n,
    upstream: [],
    upstreamBps: [],
    salt: `0x${"00".repeat(32)}`,
  };
  return { id: 1n, s, isLimit: false, oraclePriceAtCommit: P(entry), committedAt: 1000, validUntil: 2000, entryTouchedAt: 0, ...opts };
}

describe("touch detector", () => {
  const long = watched(Side.LONG, "81500", "83000", "80800");
  const short = watched(Side.SHORT, "81500", "80000", "82200");

  it("LONG: TP above, SL below, nothing in between", () => {
    expect(checkTick(long, P("83000"), 1500)).toBe(TP);
    expect(checkTick(long, P("80800"), 1500)).toBe(SL);
    expect(checkTick(long, P("82000"), 1500)).toBeNull();
  });

  it("SHORT: mirrored", () => {
    expect(checkTick(short, P("79999"), 1500)).toBe(TP);
    expect(checkTick(short, P("82200"), 1500)).toBe(SL);
    expect(checkTick(short, P("81000"), 1500)).toBeNull();
  });

  it("only inside [committedAt, validUntil]", () => {
    expect(checkTick(long, P("84000"), 999)).toBeNull();
    expect(checkTick(long, P("84000"), 2001)).toBeNull();
  });

  it("limit signal: entry first, then TP/SL only after the entry time", () => {
    // limit LONG below the market: entry 80000 while the oracle said 81500 at commit
    const lim = watched(Side.LONG, "80000", "82000", "79000", { isLimit: true, oraclePriceAtCommit: P("81500") });
    expect(checkTick(lim, P("82500"), 1100)).toBeNull(); // TP before entry doesn't count
    expect(checkTick(lim, P("80000"), 1200)).toBe(ENTRY);
    const filled = { ...lim, entryTouchedAt: 1200 };
    expect(checkTick(filled, P("82000"), 1200)).toBeNull(); // same second as entry
    expect(checkTick(filled, P("82000"), 1300)).toBe(TP);
  });

  it("a bucket spanning both levels counts as SL (can't order them)", () => {
    expect(checkBucket(long, P("80500"), P("83500"), 1500)).toEqual({ level: SL, price: P("80500") });
    expect(checkBucket(short, P("79500"), P("82500"), 1500)).toEqual({ level: SL, price: P("82500") });
    expect(checkBucket(long, P("81000"), P("83100"), 1500)).toEqual({ level: TP, price: P("83100") });
  });

  it("price history finds the first touch, or the first touch of one level", () => {
    const h = new PriceHistory();
    h.add("BTC/USD", P("81600"), 1100);
    h.add("BTC/USD", P("80700"), 1200); // SL
    h.add("BTC/USD", P("83100"), 1300); // TP later
    expect(h.firstTouch("BTC/USD", long, 1000, 2000)).toMatchObject({ level: SL, ts: 1200 });
    expect(h.firstTouch("BTC/USD", long, 1000, 2000, TP)).toMatchObject({ level: TP, ts: 1300 });
    expect(h.firstTouch("BTC/USD", long, 1250, 2000, SL)).toBeNull();
    h.prune(1300 + 7 * 24 * 3600 - 150);
    expect(h.latest("BTC/USD")).toMatchObject({ ts: 1300 });
  });
});

describe("Supra proof client (fixture)", () => {
  it("posts the pair and returns proof bytes", async () => {
    let body: any;
    const c = new SupraProofClient("https://supra.test/", async (url, init) => {
      expect(url).toBe("https://supra.test/get_proof");
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ pair_indexes: [0], proof_bytes: "0xdeadbeef" }));
    });
    expect(await c.latestProof(0)).toBe("0xdeadbeef");
    expect(body).toEqual({ pair_indexes: [0], chain_type: "evm" });
  });

  it("rejects an unexpected shape", async () => {
    const c = new SupraProofClient("https://supra.test", async () => new Response(JSON.stringify({ nope: 1 })));
    await expect(c.latestProof(0)).rejects.toThrow(/unexpected response shape/);
  });
});
