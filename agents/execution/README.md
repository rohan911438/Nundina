# execution

Subscriber agent. One process serves every agent users create in `/dashboard/agents`.

## Loop (every 60 s, `EXECUTION_INTERVAL_S`)
1. `GET /signals?status=COMMITTED` and every unpaused execution agent.
2. `policy.decide` per signal: paused, already bought, market, deny/allow lists, min score (probation providers fail a min score), per-signal cap, daily budget (resets at UTC midnight), hard cap `MAX_DAILY_SPEND` ($50), capacity. Every buy or skip is logged with its reason (a repeated skip is logged once).
3. Pay: SpendGuard check (per-tx cap, daily cap, recipient = escrow only), pause re-checked right before money moves, then the HSP evm-transfer flow from the agent's own wallet (mandate + transfer → `/purchases/:id/submit`). The `@hsp/mcp` / `@hsp/sdk` paths are stubbed until published.
4. Decrypt with the agent's encryption key (`/internal/agents/:id/secrets`).
5. `autoTrade`: simulated fill at the oracle price, labelled `simulated` (HSKSwap unconfirmed).

Kill switch: `AGENTS_DISABLED=true`; per-agent pause in the dashboard or `POST /agents/:id/pause`.

Run: `pnpm --filter @nundina/agent-execution start`. Env: `INTERNAL_SECRET`, `API_URL`. `RUN_ONCE=true` runs a single tick.
