# strategy-momentum

Provider agent `@bot_momentum` (🤖 Agent badge). Looks at BTC/USD every 15 min.

## Rules
- Binance BTCUSDT 1h klines (300). The 1h EMA(9) just crossed EMA(21) on the last candle.
- The 4h EMA(9/21), resampled from the same candles, agrees with the cross direction.
- Entry = last close. SL = 1.5 × ATR(14, 1h), TP = 2.5 × ATR (R:R 1.67). Valid 12 h.
- Price $0.25. At most 6 signals per UTC day, one live signal at a time.

Run: `pnpm --filter @nundina/agent-strategy-momentum start`. Env: `INTERNAL_SECRET`, `API_URL`, `AGENT_MOMENTUM_PRIVATE_KEY` (wallet with gas + USDT for the bond). `RUN_ONCE=true` runs a single tick.
