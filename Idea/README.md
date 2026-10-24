# Nundina

**Pay only when the call is right.**

Nundina is a trading-signal marketplace on HashKey Chain. Every signal is locked on-chain *before* the market moves. Subscribers' agents pay per signal through **HSP** into escrow. An on-chain oracle decides the result: if the call was right the provider gets paid, and if it was wrong the subscriber is refunded automatically.

Track: **HashKey Chain Horizon Hackathon (Mumbai), Track 2: Agent Payments & A2A Settlement**
Deadline: **Nov 1 2026, 21:30 IST** · Demo Day: Nov 4, Mumbai

---

## The 30-second pitch

> India has thousands of Telegram "VIP signal" groups. People pay ₹700–7,000 a month, and the only proof is screenshots, which are easy to fake. Scams worth lakhs of rupees make the news every month.
>
> Nundina makes a signal **impossible to fake and risk-free to buy**. The provider locks the call on HashKey Chain before the move. The subscriber's agent pays through HSP into escrow. The oracle settles: right means the provider is paid, wrong means the subscriber is refunded.
>
> Every call counts, so a provider can't delete the losers. Track records are unforgeable and portable through ERC-8004. KYC-verified providers get a badge through HSP attestations.
>
> It is agent-to-agent settlement with real users from day one: providers, subscribers, and AI agents that buy, combine and resell signals.

## Documents in this folder

| # | File | What's inside |
|---|---|---|
| 1 | [01-idea-and-trust.md](01-idea-and-trust.md) | The product, user flows, and the **trust design**: why a trader should believe it |
| 2 | [02-why-this.md](02-why-this.md) | The problem, evidence of demand, why now, why it fits Track 2 |
| 3 | [03-competitors.md](03-competitors.md) | Myfxbook, Collective2, Cornix, exchange copy trading, Hyperliquid, Bittensor and more, and how we differ |
| 4 | [04-why-hashkey.md](04-why-hashkey.md) | Why this must be on HashKey: HSP, compliance, oracles, gas, ecosystem |
| 5 | [05-architecture.md](05-architecture.md) | System architecture, contracts, data flows, settlement logic, anti-gaming math |
| 6 | [06-tech-stack.md](06-tech-stack.md) | Every technology choice and the reason for it |
| 7 | [07-deliverables-and-plan.md](07-deliverables-and-plan.md) | What we submit, must-haves vs stretch goals, an 8-day day-by-day plan, the demo script |
| 8 | [08-go-to-market.md](08-go-to-market.md) | Cold-start plan (free first, then pay-if-works), business model, future roadmap |
| 9 | [09-risks.md](09-risks.md) | Regulatory, technical and market risks, each with a mitigation |
| 10 | [10-research-archive.md](10-research-archive.md) | Background research (HSP, x402, ERC-8183, ERC-8004, past winners, rejected ideas) and every source |

## Urgent actions (do these today)
1. **Ask in the HashKey dev Telegram for the HSP sandbox values:** REPO_URL, COORDINATOR_URL, API_KEY, FAUCET_URL, FACILITATOR_URL. The HSP guide says these are shared "a few days" after the sandbox deploys, and everything HSP-related depends on them.
2. **Get mainnet funds:** a small amount of HSK for gas (a signal commit costs about $0.004, see `04-why-hashkey.md`) and $20–50 of USDC.e on HashKey for live demo payments.
3. **Line up 3–5 real signal providers** (small Telegram channels) willing to try the free verification bot during demo week.
