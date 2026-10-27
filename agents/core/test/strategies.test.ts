import { describe, expect, it } from "vitest";
import { atr, ema, resample, type Candle } from "../src/indicators.js";
import { rr, validGeometry } from "../src/geometry.js";
import { MOMENTUM, momentum } from "../src/strategies/momentum.js";
import { FUNDING, funding } from "../src/strategies/funding.js";
import { recent, sentiment, type SentimentRead } from "../src/strategies/sentiment.js";
import { parseFeed } from "../src/market.js";
import { supplyCheck } from "../src/runner.js";

/** Deterministic 1h candles: a price path from a function of the index, with a fixed wiggle for ATR. */
function candles(n: number, f: (i: number) => number): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const c = f(i);
    const o = i ? f(i - 1) : c;
    const w = 40 + (i % 7) * 10;
    return { t: 1_760_000_000_000 + i * 3_600_000, o, h: Math.max(o, c) + w, l: Math.min(o, c) - w, c };
  });
}
// pullback inside a trend: the 1h EMAs cross against the trend, then cross back while the 4h trend still agrees
const reversalUp = candles(240, (i) => (i < 180 ? 80_000 + i * 20 : i < 192 ? 83_600 - (i - 180) * 60 : 82_880 + (i - 192) * 80));
const reversalDown = candles(240, (i) => (i < 180 ? 90_000 - i * 20 : i < 192 ? 86_400 + (i - 180) * 60 : 87_120 - (i - 192) * 80));
const flat = candles(240, (i) => 85_000 + Math.sin(i / 3) * 50);

/** Finds the first prefix where the strategy fires (the cross is "fresh" on exactly one bar). */
function firstSignal(cs: Candle[]) {
  for (let n = 100; n <= cs.length; n++) {
    const p = momentum(cs.slice(0, n));
    if (p) return p;
  }
  return null;
}

describe("indicators", () => {
  it("ema of a constant is the constant", () => expect(ema([5, 5, 5, 5, 5], 3).every((v) => v === 5)).toBe(true));
  it("atr is positive on ranged candles", () => expect(atr(flat.slice(-50), 14)).toBeGreaterThan(0));
  it("resample groups 4 hours", () => {
    const r = resample(flat.slice(0, 40), 4);
    expect(r.length).toBeGreaterThanOrEqual(9);
    expect(r.length).toBeLessThanOrEqual(11);
  });
});

describe("momentum", () => {
  it("is silent without enough history or on a flat market", () => {
    expect(momentum(reversalUp.slice(0, 50))).toBeNull();
    for (let n = 100; n <= flat.length; n += 7) {
      const p = momentum(flat.slice(0, n));
      if (p) expect(validGeometry(p, 1.5)).toBe(true);
    }
  });
  it("goes LONG on an up-cross with valid geometry, deterministically", () => {
    const p = firstSignal(reversalUp);
    expect(p?.side).toBe("LONG");
    expect(validGeometry(p!, 1.5)).toBe(true);
    expect(rr(p!)).toBeCloseTo(MOMENTUM.tpAtr / MOMENTUM.slAtr, 1);
    expect(firstSignal(reversalUp)).toEqual(p);
  });
  it("goes SHORT on a down-cross", () => {
    const p = firstSignal(reversalDown);
    expect(p?.side).toBe("SHORT");
    expect(validGeometry(p!, 1.5)).toBe(true);
    expect(supplyCheck(p!)).toBeNull();
  });
});

describe("funding", () => {
  it("skips inside the threshold", () => {
    expect(funding(0.0001, flat)).toBeNull();
    expect(funding(-FUNDING.threshold + 1e-6, flat)).toBeNull();
    expect(funding(Number.NaN, flat)).toBeNull();
  });
  it("fades crowded longs and shorts", () => {
    const s = funding(0.001, flat)!;
    const l = funding(-0.0008, flat)!;
    expect(s.side).toBe("SHORT");
    expect(l.side).toBe("LONG");
    for (const p of [s, l]) {
      expect(validGeometry(p, 1.5)).toBe(true);
      expect(supplyCheck(p)).toBeNull();
      expect(p.entry).toBeCloseTo(flat.at(-1)!.c, 1);
    }
  });
});

describe("sentiment", () => {
  const read = (o: Partial<SentimentRead> = {}): SentimentRead => ({ score: 0.8, confidence: 0.8, reasons: ["ETF inflows"], relevantHeadlines: 5, ...o });
  it("needs strong, confident, multi-source reads", () => {
    expect(sentiment(null, 5, flat)).toBeNull();
    expect(sentiment(read(), 2, flat)).toBeNull();
    expect(sentiment(read({ score: 0.5 }), 5, flat)).toBeNull();
    expect(sentiment(read({ confidence: 0.4 }), 5, flat)).toBeNull();
    expect(sentiment(read({ relevantHeadlines: 1 }), 5, flat)).toBeNull();
  });
  it("posts the direction of the score with valid geometry and the reasons", () => {
    const up = sentiment(read(), 4, flat)!;
    const down = sentiment(read({ score: -0.9 }), 4, flat)!;
    expect(up.side).toBe("LONG");
    expect(down.side).toBe("SHORT");
    expect(validGeometry(up, 1.5) && validGeometry(down, 1.5)).toBe(true);
    expect(up.rationale).toContain("ETF inflows");
  });
  it("keeps only recent headlines and counts sources", () => {
    const t = Date.parse("2026-10-27T12:00:00Z");
    const hs = [
      { title: "a", source: "x", publishedAt: t - 3_600_000 },
      { title: "b", source: "y", publishedAt: t - 2 * 3_600_000 },
      { title: "c", source: "y", publishedAt: t - 7 * 3_600_000 },
      { title: "d", source: "z", publishedAt: t + 60_000 },
    ];
    const r = recent(hs, t);
    expect(r.fresh.map((h) => h.title)).toEqual(["a", "b"]);
    expect(r.sources).toBe(2);
  });
  it("parses RSS and Atom", () => {
    const rss = `<rss><channel><item><title><![CDATA[BTC &amp; ETFs]]></title><pubDate>Tue, 27 Oct 2026 10:00:00 GMT</pubDate></item><item><title>no date</title></item></channel></rss>`;
    const atom = `<feed><entry><title>Miners sell</title><updated>2026-10-27T09:00:00Z</updated></entry></feed>`;
    expect(parseFeed(rss, "a")).toEqual([{ title: "BTC & ETFs", source: "a", publishedAt: Date.parse("2026-10-27T10:00:00Z") }]);
    expect(parseFeed(atom, "b")[0]?.title).toBe("Miners sell");
  });
});
