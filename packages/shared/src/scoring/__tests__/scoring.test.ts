import { describe, expect, it } from "vitest";
import {
  alphaVsBtc,
  compositeScore,
  expectancy,
  maxDrawdownR,
  scoreProvider,
  wilsonLowerBound,
  type ScoringSignal,
} from "../index";

const sig = (o: Partial<ScoringSignal>): ScoringSignal => ({
  outcome: "WIN",
  rMultiple: 2,
  committedAt: 0,
  decidedAt: 0,
  market: "BTC/USD",
  ...o,
});

describe("wilson", () => {
  it("3/3 ranks below 60/100", () => {
    expect(wilsonLowerBound(3, 3)).toBeLessThan(wilsonLowerBound(60, 100));
    expect(wilsonLowerBound(3, 3)).toBeCloseTo(0.4385, 3);
    expect(wilsonLowerBound(60, 100)).toBeCloseTo(0.5020, 3);
  });
  it("0/0 is 0", () => expect(wilsonLowerBound(0, 0)).toBe(0));
});

describe("expectancy", () => {
  it("matches a hand-computed example", () => {
    // +2, +1.5, −1, −1 (unrevealed), VOID excluded → (2 + 1.5 − 1 − 1) / 4 = 0.375
    const xs = [
      sig({ outcome: "WIN", rMultiple: 2 }),
      sig({ outcome: "WIN", rMultiple: 1.5 }),
      sig({ outcome: "LOSS", rMultiple: -0.6 }), // losses always −1R
      sig({ outcome: "UNREVEALED", rMultiple: 0 }),
      sig({ outcome: "VOID", rMultiple: 0 }),
    ];
    expect(expectancy(xs)).toBeCloseTo(0.375, 10);
  });
});

describe("alpha", () => {
  it("a LONG in a market that went up the same amount has ~0 alpha", () => {
    const s = sig({ side: "LONG", entry: 80_000, exitPrice: 84_000, btcAtCommit: 80_000, btcAtExit: 84_000 });
    expect(alphaVsBtc([s])).toBeCloseTo(0, 10);
  });
  it("a SHORT that made money while BTC rose has positive alpha", () => {
    const s = sig({ side: "SHORT", entry: 100, exitPrice: 95, btcAtCommit: 80_000, btcAtExit: 84_000 });
    expect(alphaVsBtc([s])).toBeCloseTo(5 - 5, 10); // +5% short − (+5%) BTC
    const s2 = sig({ side: "SHORT", entry: 100, exitPrice: 95, btcAtCommit: 80_000, btcAtExit: 80_000 });
    expect(alphaVsBtc([s2])).toBeCloseTo(5, 10);
  });
  it("is null without prices", () => expect(alphaVsBtc([sig({})])).toBeNull());
});

describe("drawdown", () => {
  it("peak to trough on cumulative R", () => {
    const xs = [2, -1, -1, -1, 3, -1].map((r, i) => sig({ outcome: r > 0 ? "WIN" : "LOSS", rMultiple: r, decidedAt: i }));
    expect(maxDrawdownR(xs)).toBe(3);
  });
});

describe("score", () => {
  const base = { wilsonLb: 0.45, expectancyR: 0.4, alphaPct: 1, maxDrawdownR: 4 };

  it("is within 0..100", () => {
    expect(compositeScore({ wilsonLb: 0, expectancyR: -5, alphaPct: -50, maxDrawdownR: 100 })).toBe(0);
    expect(compositeScore({ wilsonLb: 1, expectancyR: 5, alphaPct: 50, maxDrawdownR: 0 })).toBe(100);
  });

  it("is monotonic: improving any input never lowers the score", () => {
    const s0 = compositeScore(base);
    const steps = [0.01, 0.1, 0.5, 2];
    for (const d of steps) {
      expect(compositeScore({ ...base, wilsonLb: Math.min(1, base.wilsonLb + d) })).toBeGreaterThanOrEqual(s0);
      expect(compositeScore({ ...base, expectancyR: base.expectancyR + d })).toBeGreaterThanOrEqual(s0);
      expect(compositeScore({ ...base, alphaPct: base.alphaPct + d })).toBeGreaterThanOrEqual(s0);
      expect(compositeScore({ ...base, maxDrawdownR: Math.max(0, base.maxDrawdownR - d) })).toBeGreaterThanOrEqual(s0);
    }
    // random walk: each step improves one input
    let cur = { ...base };
    let prev = compositeScore(cur);
    for (let i = 0; i < 200; i++) {
      const k = i % 4;
      cur =
        k === 0
          ? { ...cur, wilsonLb: Math.min(1, cur.wilsonLb + 0.003) }
          : k === 1
            ? { ...cur, expectancyR: cur.expectancyR + 0.02 }
            : k === 2
              ? { ...cur, alphaPct: cur.alphaPct + 0.05 }
              : { ...cur, maxDrawdownR: Math.max(0, cur.maxDrawdownR - 0.05) };
      const next = compositeScore(cur);
      expect(next).toBeGreaterThanOrEqual(prev);
      prev = next;
    }
  });

  it("puts providers below 30 signals on probation with no score", () => {
    const few = Array.from({ length: 29 }, (_, i) => sig({ decidedAt: i }));
    const r = scoreProvider(few);
    expect(r.probation).toBe(true);
    expect(r.score).toBeNull();
    const enough = scoreProvider([...few, sig({ outcome: "LOSS", decidedAt: 99 })]);
    expect(enough.probation).toBe(false);
    expect(enough.n).toBe(30);
    expect(enough.score).toBeGreaterThan(0);
  });

  it("VOIDs do not count toward n", () => {
    const r = scoreProvider([sig({ outcome: "VOID" }), sig({})]);
    expect(r.n).toBe(1);
    expect(r.voids).toBe(1);
  });
});
