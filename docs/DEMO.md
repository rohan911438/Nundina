# Demo runbook (≤ 3 min video + Demo Day backup)

Follows `Idea/07-deliverables-and-plan.md` §7.4 exactly. Record on the production chain if it's live, otherwise on testnet. If you record on a local chain, say so on screen.

## T−60 min: stage
1. `/status` is all green (API, relayer, keeper, bot, mcp).
2. Pre-stage the settlement signals:
   ```bash
   DEMO_BULL_PRIVATE_KEY=0x… DEMO_BEAR_PRIVATE_KEY=0x… AGENT_AGGREGATOR_PRIVATE_KEY=0x… \
   DEMO_EXPIRY_MIN=40 pnpm --filter @nundina/agent-aggregator stage-demo
   ```
   This posts a mirrored LONG/SHORT pair, so one settles WIN and one LOSS within about 40–55 min, plus an aggregator meta-signal with upstream bps. Write down the ids it prints.
3. Buy both pair signals from a second wallet (web or Mini App) so there is a pot to pay out and to refund.
4. Open these tabs: the Telegram channel, Blockscout (SignalBook, PerformanceEscrow, RevenueRouter), the HSP explorer, the web leaderboard and `/s/<id>` for each staged signal.

## Recording (3:00)
| Time | Show | Proof on screen |
|---|---|---|
| 0:00–0:25 | Hook: the ₹42 lakh Telegram scam headline. "Signal groups run on screenshots." | |
| 0:25–1:00 | Provider posts "BTC LONG …" in the channel → bot confirm → lock card | Blockscout commit tx, timestamped before the move |
| 1:00–1:40 | Execution agent: policy check (score, daily cap) → HSP pay → decrypt | HSP mandate + ACCEPT receipt, escrow credit tx, signal decrypted in the DMs or Mini App |
| 1:40–2:20 | The staged pair settles: keeper proof → WIN paid, LOSS refunded + bond slice | `settle` txs and the escrow claim balances |
| 2:20–2:45 | Aggregator meta-signal WIN → upstreams paid | `Routed` events on RevenueRouter, ERC-8004 feedback |
| 2:45–3:00 | Leaderboard with this week's real providers. "Pay only when the call is right." | |

## Backup
- Before Demo Day, record the whole flow once more end to end (screen + voice) and keep it offline on the laptop and on a USB stick.
- If the chain or HSP is down live, play the backup and show the same txs on Blockscout from the browser history.
- The local fallback `pnpm --filter @nundina/keeper demo:aggregator` reproduces the A2A WIN on anvil in about 1 minute.
