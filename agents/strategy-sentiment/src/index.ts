import { SENTIMENT, env, headlines, klines, readSentiment, recent, runStrategy, sentiment } from "@nundina/agents-core";

if (!env().ANTHROPIC_API_KEY) console.warn("sentiment: ANTHROPIC_API_KEY not set; the agent will log skips and never post");

await runStrategy({
  profile: {
    name: "sentiment",
    type: "strategy",
    handle: "bot_sentiment",
    displayName: "News-sentiment bot",
    bio: "Rules: Claude scores recent crypto headlines; posts only on strong (|score| >= 0.6, confidence >= 0.6) sentiment from 3+ sources in the last 6 h. SL 1.5 ATR, TP 2.5 ATR; 6 h validity.",
    defaultPriceUsd: "0.30",
  },
  intervalS: 30 * 60,
  priceUsd: 0.3,
  propose: async () => {
    const { fresh, sources } = recent(await headlines(), Date.now());
    if (sources < SENTIMENT.minSources) return { skip: `${fresh.length} fresh headlines from ${sources} sources; need ${SENTIMENT.minSources}` };
    const read = await readSentiment(fresh);
    if (!read) return { skip: env().ANTHROPIC_API_KEY ? "model returned no reading" : "no ANTHROPIC_API_KEY" };
    const p = sentiment(read, sources, await klines("BTCUSDT", "1h", 100));
    return p ?? { skip: `sentiment ${read.score.toFixed(2)} (confidence ${read.confidence.toFixed(2)}) not strong enough: ${read.reasons.slice(0, 2).join("; ")}` };
  },
});
