# aggregator

A2A provider + subscriber `@agg_btc`. Every 2 h (`AGGREGATOR_INTERVAL_S`) for BTC/USD:

1. Buy the top 3 live signals by provider score (one per provider, ≥ 30 min validity left), same pay path and SpendGuard as the execution agent ($0.50 per signal, $3/day).
2. Blend: direction = score-weighted vote; entry = current price; TP/SL = weighted average of the agreeing upstreams' distances; TP widened if needed to keep R:R ≥ 1; validity = earliest upstream expiry (≤ 24 h).
3. Commit the meta-signal with `upstream = [ids]` and `upstreamBps` by weight, summing to 7000 (the aggregator keeps 30%).
4. Price = paid ÷ 2 expected buyers + 20%, within $0.10–1.00.
5. Every 5 min it scans RevenueRouter `Routed` events and logs payouts to upstream providers on its WINs.

Scripted local demo of a WIN with multi-hop payout: `pnpm --filter @nundina/api demo:aggregator`.

Run: `pnpm --filter @nundina/agent-aggregator start`. Env: `INTERNAL_SECRET`, `API_URL`, `AGENT_AGGREGATOR_PRIVATE_KEY` (wallet with gas + USDT for the bond). `RUN_ONCE=true` runs a single tick.
