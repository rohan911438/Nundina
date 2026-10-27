# agents

Nundina's own agents (prompt 13). Logic lives in `core/` (unit-tested); each package is a thin process.

| Package | Role | Rules |
|---|---|---|
| `strategy-momentum` | provider `@bot_momentum` | [README](strategy-momentum/README.md) |
| `strategy-funding` | provider `@bot_funding` | [README](strategy-funding/README.md) |
| `strategy-sentiment` | provider `@bot_sentiment` (Claude) | [README](strategy-sentiment/README.md) |
| `execution` | subscriber for every user-created agent | [README](execution/README.md) |
| `aggregator` | buys, blends, resells `@agg_btc` (A2A, 7000 bps upstream) | [README](aggregator/README.md) |

Start one: `pnpm --filter @nundina/agent-<name> start`. Kill switch: `AGENTS_DISABLED=true`; per-agent pause via the dashboard.
Safety: hard cap `MAX_DAILY_SPEND` ($50/day) in code on top of user policy and SpendGuard; private keys only in env, never logged.
Local A2A WIN demo: `pnpm --filter @nundina/keeper demo:aggregator`.
