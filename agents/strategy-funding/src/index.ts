import { FUNDING, funding, fundingRate, klines, runStrategy } from "@nundina/agents-core";

await runStrategy({
  profile: {
    name: "funding",
    type: "strategy",
    handle: "bot_funding",
    displayName: "Funding-rate bot",
    bio: "Rules: fades extreme BTC perp funding (|rate| >= 0.05%/8h): crowded longs -> SHORT, crowded shorts -> LONG; SL 1.5 ATR, TP 2.5 ATR; 8 h validity.",
    defaultPriceUsd: "0.20",
  },
  intervalS: 30 * 60,
  priceUsd: 0.2,
  propose: async () => {
    const [rate, h1] = await Promise.all([fundingRate("BTCUSDT"), klines("BTCUSDT", "1h", 100)]);
    return funding(rate, h1, FUNDING) ?? { skip: `funding ${(rate * 100).toFixed(4)}%/8h is inside ±${(FUNDING.threshold * 100).toFixed(3)}%` };
  },
});
