import { describe, expect, it } from "vitest";
import { backfill } from "../src/feeds/binance.js";

const gateCandle = (t: number, low: string, high: string) => [String(t), "0", "0", high, low, "0", "0", "true"];

describe("backfill", () => {
  it("falls back to Gate for BTC when Binance is unreachable, and still fills HSK", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      if (url.includes("binance.com")) throw new TypeError("fetch failed");
      const pair = new URL(url).searchParams.get("currency_pair");
      const rows = pair === "BTC_USDT" ? [gateCandle(1000, "80000", "80100")] : [gateCandle(1000, "0.5", "0.51")];
      return new Response(JSON.stringify(rows));
    }) as typeof fetch;

    const got: [string, bigint, bigint, number][] = [];
    const failed = await backfill(0, (m, lo, hi, ts) => got.push([m, lo, hi, ts]), fetchImpl);

    expect(failed).toEqual([]);
    expect(urls.some((u) => u.includes("currency_pair=BTC_USDT"))).toBe(true);
    expect(got).toContainEqual(["BTC/USD", 8_000_000_000_000n, 8_010_000_000_000n, 1000]);
    expect(got.find((g) => g[0] === "HSK/USD")).toBeDefined();
  });

  it("uses the primary venue when it answers, and reports markets no venue could fill", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      if (url.includes("binance.com")) return new Response(JSON.stringify([[1000_000, "0", "80100", "80000"]]));
      return new Response("down", { status: 503 });
    }) as typeof fetch;

    const failed = await backfill(0, () => {}, fetchImpl);

    expect(urls.some((u) => u.includes("currency_pair=BTC_USDT"))).toBe(false); // primary answered
    expect(failed).toEqual(["HSK/USD"]);
  });
});
