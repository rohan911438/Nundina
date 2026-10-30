# Why Nundina

## The problem

- **A large, informal, trust-broken market.** Paid Telegram signal tiers cost roughly ₹700 to ₹7,000 ($8 to $80) a month. Large channels run free funnels of tens of thousands of members into paid "VIP" groups.
- **Fraud is common, especially in India.** Fake profit screenshots, "VIP signal" scams paid by UPI, and pump-and-dumps on followers are reported regularly. Security firms such as CYFIRMA and Quick Heal have documented Telegram crypto scam campaigns aimed at Indian users.
- **Retail traders are already losing.** SEBI's FY25 study found that 91% of individual F&O traders lost money.
- **Existing "proof" is weak:**
  - Screenshots and self-reported win rates are marketing.
  - Cornix marketplace statistics are backtested, not live.
  - Exchange copy-trading statistics are verified, but only for traders on that exchange: custodial, and not portable.
- **Honest providers cannot prove they are honest.** That is the opening.

## What changes for users

| Pain | Today | With Nundina |
|---|---|---|
| "Is this provider a scammer?" | Screenshots | Every call committed before the move, every call counted, verified channel ownership |
| "I paid and the signals lost money" | No recourse | Per-signal refund when wrong, plus a slice of the provider's bond |
| "Was it luck?" | No way to tell | Minimum sample size, Wilson bound, expectancy, alpha vs BTC |
| "How do I prove I'm good?" (provider) | Post screenshots and hope | A free verified profile and an open, recomputable score |
| "Can my agent trust this data source?" | No | Track records recomputed from chain data over MCP |

## Why now

1. **Agent payment rails exist, but real demand is thin.** Studies of x402 traffic find only a small share is truly agentic. Products win when they bring **real buyers** to these rails. Signal buyers already pay today.
2. **Agents are becoming traders.** A growing share of on-chain trading and prediction-market activity comes from bots and agents. They need to **buy and verify alpha from other agents**, which Nundina supports natively.
3. **Portable reputation is arriving.** ERC-8004 (agent identity and reputation) is live on several chains, but **not on HashKey Chain**. Nundina deploys it there.
4. **HSP launched with compliance built in,** which suits a product whose whole purpose is trust.

## Fit with Track 2: Agent Payments & A2A Settlement

| Track requirement | How Nundina meets it |
|---|---|
| Uses HSP | Every purchase is an HSP-style Payment Mandate (EIP-712) followed by a verified stablecoin transfer into escrow. The HSP merchant gateway rail is built and switches on with merchant credentials |
| Agent payments | Execution agents buy signals on their own, within user-signed budgets and spend rules |
| A2A settlement | Aggregator agents buy from provider agents and resell; `RevenueRouter` splits each win back to upstream providers across up to 3 hops |
| Deployed on HashKey Chain | Full contract suite on testnet (133), with a mainnet deploy script and a passing mainnet-fork dry run |
| Beyond a payment button | Conditional settlement: payment depends on a verified real-world outcome |

## Why this, rather than another payments product

- **Escrow, spend wallets and pay-per-call** are components here, not the product.
- **Payroll, invoicing and natural-language payment bots** already exist in the HashKey ecosystem. Outcome-conditional, multi-hop A2A settlement does not.
- **Real users exist on day one:** buyers and sellers of signals already pay each other in Telegram. Nundina moves that payment onto rails that make honesty verifiable.
