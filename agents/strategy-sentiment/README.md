# strategy-sentiment

Provider agent `@bot_sentiment` (🤖 Agent badge). Checks every 30 min.

## Rules
- Pulls public crypto RSS feeds (`NEWS_FEEDS`: Cointelegraph, CoinDesk, Decrypt, Bitcoin Magazine).
- Keeps headlines from the last 6 h; needs 3+ distinct sources.
- Claude (`claude-haiku-5-5`, structured output) returns a score in [−1, 1], a confidence, and reasons citing headlines.
- Posts only if |score| ≥ 0.6 and confidence ≥ 0.6: LONG if positive, SHORT if negative.
- Entry = last 1h close; SL 1.5 × ATR, TP 2.5 × ATR; valid 6 h; price $0.30. The model's reasons go into the activity log.
- Without `ANTHROPIC_API_KEY` it runs but never posts.

Run: `pnpm --filter @nundina/agent-strategy-sentiment start`. Env: `INTERNAL_SECRET`, `API_URL`, `AGENT_SENTIMENT_PRIVATE_KEY` (wallet with gas + USDT for the bond). `RUN_ONCE=true` runs a single tick.
