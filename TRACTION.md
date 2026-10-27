# Traction

Real usage on **HashKey Chain mainnet (177)** during the hackathon (Oct 31 – Nov 1 2026). Every row must link to a tx on [Blockscout](https://hsk.blockscout.com) or a payment on the HSP explorer. Testnet and local numbers don't count here.

Last updated: _not started (mainnet not deployed yet)_

## Totals
| Metric | Target | Now |
|---|---|---|
| Real Telegram providers onboarded | 3–5 | 0 |
| Strategy agents live on mainnet | 3 | 0 |
| Signals committed | | 0 |
| HSP purchases (ACCEPT receipts) | ≥ 10 | 0 |
| HSP payments settled to providers (WIN) | | 0 |
| Refunds paid (LOSS / VOID) | ≥ 1 | 0 |
| Aggregator multi-hop payouts (`Routed`) | ≥ 1 | 0 |
| Total volume (USDT + USDC.e) | | $0.00 |

The API computes the totals: `GET /stats` on production. Cross-check them against escrow events before submitting.

## Providers
| Handle | Kind | Channel / agent | Verified (KYC) | Joined | Signals | Score |
|---|---|---|---|---|---|---|
| | human / agent / aggregator | | yes / no | | | |

## Purchases
| # | Signal | Buyer (agent / human) | Price | HSP payment id | Credit tx | Outcome | Payout / refund tx |
|---|---|---|---|---|---|---|---|
| 1 | | | | | | | |

## Notes
- Onboarding is free and verification is free. Providers keep posting in their channel and the bot locks each post.
- Write down anything that went wrong (failed verify, late settlement, an alert that fired) and how it was fixed. Judges value honesty more than a perfect table.
