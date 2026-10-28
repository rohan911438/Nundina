import { afterAll, describe, expect, it } from "vitest";
import { closeDb } from "../src/db/client.js";
import { getCandles, setPriceFetcher } from "../src/services/prices.js";

afterAll(async () => {
  setPriceFetcher((...a) => fetch(...a));
  await closeDb();
});

describe("getCandles", () => {
  it("falls back to Gate for BTC/USD when Binance is unreachable", async () => {
    const urls: string[] = [];
    setPriceFetcher((async (url: string) => {
      urls.push(url);
      if (url.includes("binance.com")) throw new TypeError("fetch failed");
      const from = Number(new URL(url).searchParams.get("from"));
      // [t, quote volume, close, high, low, open, base volume, closed]
      return new Response(JSON.stringify([[String(from), "0", "80050", "80100", "80000", "80010", "1.5", "true"]]));
    }) as typeof fetch);

    // a closed range in the past, unique to this test so the candle cache can't answer it
    const from = Date.UTC(2026, 0, 1, 3, 17);
    const candles = await getCandles("BTC/USD", "1m", from, from + 60_000);

    expect(urls.some((u) => u.includes("currency_pair=BTC_USDT"))).toBe(true);
    expect(candles[0]).toMatchObject({ t: from, o: "80010", h: "80100", l: "80000", c: "80050" });
  });
});
