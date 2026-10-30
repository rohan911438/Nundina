# Demo

**Video:** https://youtu.be/ywom_FiJURU

## Try it live (HashKey Chain testnet)

1. Open https://nundina-signals.vercel.app/leaderboard and pick a provider or a live signal.
2. On a signal page (`/s/<id>`), connect a wallet on HashKey testnet (chain 133). Free signals unlock in one tap; paid signals use HSP's testnet USDT or USDC.
3. Watch the lifecycle timeline: committed → bought → touch proven or expired → settled → revealed.
4. In Telegram, open [@Nundina_Signals_bot](https://t.me/Nundina_Signals_bot) and press **Start**. The menu button opens the Mini App.
5. To post as a provider: `/start` → connect a wallet → `/link_channel`, then post `/link <code>` in your channel with the bot as admin. Your next signal post becomes an on-chain commit after you confirm it.
6. System health for every component: https://nundina-signals.vercel.app/status

## What the demo shows

| Part | What happens | Proof |
|---|---|---|
| Lock | A provider posts "BTC LONG …" in a Telegram channel → the bot asks for confirmation → a locked card appears | Commit transaction on `SignalBook`, timestamped before the move |
| Pay | A buyer (or an execution agent within its budget) pays per signal → the signal is decrypted on the device | Payment Mandate signature, transfer into `PerformanceEscrow`, escrow credit transaction |
| Settle | The keeper proves a touch or resolves at expiry → WIN pays the provider, LOSS refunds the buyer with a bond slice | `settle` transaction and escrow claim balances |
| A2A | An aggregator buys two upstream signals, blends them, and resells the meta-signal; the win is split back upstream | `Routed` events on `RevenueRouter`, ERC-8004 feedback |
| Prove | The provider's score and the leaderboard update | Score recomputable from chain data (MCP `verify_track_record`) |

## Reproduce locally

The full agent-to-agent flow runs on a local chain in about a minute:

```bash
pnpm chain:local                                  # anvil on :8545, separate terminal
pnpm contracts:deploy:local && pnpm contracts:export
pnpm --filter @nundina/keeper demo:aggregator
```

It runs two upstream providers → an aggregator meta-signal → an execution agent buying it → keeper settlement → `Routed` payouts to both upstream providers.

To stage a recording on a live chain, `pnpm --filter @nundina/agent-aggregator stage-demo` posts a mirrored LONG/SHORT pair with a short expiry (one settles WIN and one LOSS, whichever way BTC moves) plus an aggregator meta-signal. It needs two funded demo wallets and the aggregator key in the environment (`DEMO_BULL_PRIVATE_KEY`, `DEMO_BEAR_PRIVATE_KEY`, `AGENT_AGGREGATOR_PRIVATE_KEY`).
