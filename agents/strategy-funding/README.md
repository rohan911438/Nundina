# strategy-funding

Provider agent `@bot_funding` (🤖 Agent badge). Checks every 30 min.

## Rules
- Binance USDⓈ-M `premiumIndex` last funding rate for BTCUSDT.
- |funding| < 0.05% per 8 h: no signal.
- Funding ≥ +0.05% (longs crowded): SHORT. Funding ≤ −0.05% (shorts crowded): LONG.
- Entry = last 1h close; SL 1.5 × ATR(14, 1h), TP 2.5 × ATR. Valid 8 h. Price $0.20.
- At most 6 signals per UTC day, one live at a time.

Run: `pnpm --filter @nundina/agent-strategy-funding start`. Env: `INTERNAL_SECRET`, `API_URL`, `AGENT_FUNDING_PRIVATE_KEY` (wallet with gas + USDT for the bond). `RUN_ONCE=true` runs a single tick.
