import { describe, expect, it } from "vitest";
import { UPSTREAM_TOTAL_BPS, blend, splitBps, weights, type Upstream } from "../src/blend.js";
import { rr, validGeometry } from "../src/geometry.js";
import { metaPrice } from "../src/aggregator.js";

const nowS = 1_800_000_000;
const up = (o: Partial<Upstream>): Upstream => ({ signalId: "1", score: 50, side: "LONG", entry: 80_000, takeProfit: 82_000, stopLoss: 79_000, validUntil: nowS + 6 * 3600, ...o });

describe("weights and bps", () => {
  it("weights are score-proportional and sum to 1", () => {
    const w = weights([up({ score: 60 }), up({ score: 30 }), up({ score: 10 })]);
    expect(w[0]).toBeCloseTo(0.6);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });
  it("a zero score still counts a little", () => expect(weights([up({ score: 0 }), up({ score: 99 })])[0]).toBeGreaterThan(0));
  it.each([[[1 / 3, 1 / 3, 1 / 3]], [[0.6, 0.3, 0.1]], [[0.501, 0.499]], [[1]], [[0.07, 0.13, 0.8]]])("bps sum exactly 7000 for %j", (ws) => {
    const bps = splitBps(ws);
    expect(bps.reduce((a, b) => a + b, 0)).toBe(UPSTREAM_TOTAL_BPS);
    expect(bps.every((b) => b >= 0 && Number.isInteger(b))).toBe(true);
  });
});

describe("blend", () => {
  it("score-weighted vote picks the side; entry is the current price; R:R ≥ 1", () => {
    const b = blend([up({ signalId: "1", score: 70 }), up({ signalId: "2", score: 60 }), up({ signalId: "3", score: 40, side: "SHORT", takeProfit: 78_000, stopLoss: 81_000 })], 80_500, nowS)!;
    expect(b.proposal.side).toBe("LONG");
    expect(b.proposal.entry).toBe(80_500);
    expect(validGeometry(b.proposal, 1)).toBe(true);
    expect(rr(b.proposal)).toBeGreaterThanOrEqual(1);
    expect(b.upstream).toEqual(["1", "2", "3"]);
    expect(b.upstreamBps.reduce((a, x) => a + x, 0)).toBe(7000);
    expect(b.upstreamBps[0]).toBeGreaterThan(b.upstreamBps[2]!);
  });
  it("uses weighted distances of the agreeing upstreams", () => {
    // both 2.5% TP / 1.25% SL → blend keeps those distances at the new price
    const b = blend([up({ signalId: "1", entry: 80_000, takeProfit: 82_000, stopLoss: 79_000 }), up({ signalId: "2", entry: 40_000, takeProfit: 41_000, stopLoss: 39_500 })], 100_000, nowS)!;
    expect(b.proposal.takeProfit).toBeCloseTo(102_500, 0);
    expect(b.proposal.stopLoss).toBeCloseTo(98_750, 0);
  });
  it("widens TP to keep R:R ≥ 1 when upstreams have tight targets", () => {
    const b = blend([up({ takeProfit: 80_500, stopLoss: 79_000 }), up({ signalId: "2", takeProfit: 80_400, stopLoss: 79_200 })], 80_000, nowS)!;
    expect(rr(b.proposal)).toBeGreaterThanOrEqual(1 - 1e-9);
  });
  it("an even split produces no meta-signal", () => {
    expect(blend([up({ score: 50 }), up({ signalId: "2", score: 50, side: "SHORT", takeProfit: 78_000, stopLoss: 81_000 })], 80_000, nowS)).toBeNull();
  });
  it("validity is the earliest upstream expiry, capped at 24 h", () => {
    expect(blend([up({ validUntil: nowS + 3 * 3600 }), up({ signalId: "2", validUntil: nowS + 9 * 3600 })], 80_000, nowS)!.proposal.validHours).toBe(3);
    expect(blend([up({ validUntil: nowS + 90 * 3600 })], 80_000, nowS)!.proposal.validHours).toBe(24);
  });
  it("SHORT blends have valid geometry", () => {
    const b = blend([up({ side: "SHORT", takeProfit: 77_000, stopLoss: 81_500, score: 80 }), up({ signalId: "2", side: "SHORT", takeProfit: 78_500, stopLoss: 80_800 })], 80_100, nowS)!;
    expect(b.proposal.side).toBe("SHORT");
    expect(validGeometry(b.proposal, 1)).toBe(true);
  });
});

describe("meta price", () => {
  it("prices above paid ÷ expected buyers, within bounds", () => {
    expect(metaPrice(900_000n)).toBe(0.54); // 0.90 / 2 * 1.2
    expect(metaPrice(100_000n)).toBe(0.1);
    expect(metaPrice(5_000_000n)).toBe(1);
  });
});
