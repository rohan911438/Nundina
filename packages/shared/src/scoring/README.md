# Nundina provider score

The scoring code is open source so anyone can recompute any profile from on-chain data
(`SignalCommitted`, `SignalRevealed`, `Resolved`, `SignalUnrevealed`) plus public BTC prices.
Everything here is a pure function in `packages/shared/src/scoring`.

## Inputs

These are the provider's **decided** signals in the period (7d, 30d or all), filtered by market when one is selected.

| Outcome | Counts as |
|---|---|
| WIN | its on-chain R multiple (`rX100 / 100`) |
| LOSS | −1R |
| Unrevealed (missed the reveal window) | −1R |
| VOID | excluded from everything except the `voids` count |

## Metrics

- **n**: the number of decided, non-void signals.
- **Wilson lower bound** of the win rate, at z = 1.96. A 3/3 record (0.44) ranks below 60/100 (0.50).
- **Expectancy**: the mean R per signal.
- **Alpha vs BTC**: for each signal, the return in its own direction minus BTC buy-and-hold over the same
  window (commit to decision), in percent. The metric is the mean of these. A BTC long that only rode
  the market scores about 0. Signals without price data are skipped.
- **Max drawdown**: the largest peak-to-trough fall of cumulative R, taken in decision order.
- **Follower PnL**: the mean realised % after fees, from execution agents' recorded fills (when present).

## Score (0–100)

```
score = 100 × ( 0.40 × clamp(wilsonLb, 0, 1)
              + 0.30 × (clamp(expectancyR, −1, 2) + 1) / 3
              + 0.20 × (clamp(alphaPct, −5, 5) + 5) / 10      (alpha unknown → 0%)
              + 0.10 × (1 − clamp(maxDrawdownR / 10, 0, 1)) )
```

- Every term rises when its input gets better, so improving any one input can never lower the score.
- **Probation**: below 30 decided signals there is no score (`score = null`). The profile shows
  "Probation" instead of a rank.
