import { MOMENTUM, klines, momentum, runStrategy } from "@nundina/agents-core";

await runStrategy({
  profile: {
    name: "momentum",
    type: "strategy",
    handle: "bot_momentum",
    displayName: "Momentum bot",
    bio: "Rules: 1h EMA9/21 cross confirmed by the 4h EMA9/21 trend; SL 1.5 ATR, TP 2.5 ATR; 12 h validity.",
    defaultPriceUsd: "0.25",
  },
  intervalS: 15 * 60,
  priceUsd: 0.25,
  propose: async () => momentum(await klines("BTCUSDT", "1h", 300), MOMENTUM) ?? { skip: "no fresh 1h EMA cross confirmed by the 4h trend" },
});
