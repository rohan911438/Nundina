# 1. Timeline

## Fixed constraints (from day 0)
| Constraint | Value |
|---|---|
| Event | HashKey Chain Horizon Hackathon, Mumbai edition |
| Track | **Track 2: Agent Payments & A2A Settlement** |
| Must use | **HSP** (HashKey Settlement Protocol) |
| Must deploy | Contracts on **HashKey Chain mainnet** (chainId 177) |
| Deadline | **Sun Nov 1 2026, 21:30 IST** (internal target 18:00 IST) |
| Demo Day | Nov 4, Mumbai (in-person teams get priority) |
| Bonus points | Using officially recommended products and frameworks (HSP SDK layers, AgentKit, etc.) |

## Journey

| When | Phase | What happened | Outcome |
|---|---|---|---|
| Oct 23 | **Round 1, iteration 1** | Read the HSP developer guide end to end. Learned HSP is one-shot, single-leg, zero-custody payments with no escrow, refunds, splits or streaming. | Gaps found: escrow, conditional release, identity/reputation, on-chain spend policy |
| Oct 23 | **Round 1, iteration 2** | Researched x402 (volume, wash trading), past agent-payment hackathon winners, and ERC-8183 (agent job escrow standard). | "Compliant ACP for HashKey" idea forms |
| Oct 23 | **Round 1, iteration 3** | Researched AP2 mandates, ERC-8004, MPP streaming, and **past HashKey winners** (FlowLink, hashpay, HSP Payment Agent, SentryPay, Maneki AI). Checked on-chain: **ERC-8004 is not deployed on HashKey.** | Rule: don't repeat payroll, invoicing or NL payment bots, which already won here |
| Oct 23 | **Round 1, iteration 4** | Agent payment products with traction (Nevermined, Skyfire, Payman, Crossmint), HashKey token facts (USDT has no EIP-3009, USDC.e does), India angle. | Final R1 pick: Compliant Agent Commerce (27 points) |
| Oct 23 | **Pivot 1** | Feedback: *escrow, spend wallet and pay-per-call are too basic and already built.* | Go to frontier research |
| Oct 23–24 | **Round 2** | Academic surveys (SoK on A2A payments, A2A finance, x402 attack paper, TessPay), x402 batch settlement, Bank of Bots, CLS/DTCC netting numbers. | AgentCCP (netting clearing house) wins Round 2 (44 points) |
| Oct 24 | **Pivot 2** | Feedback: *AgentCCP is too niche and futuristic. Where do users come from tomorrow?* | Demand reality check |
| Oct 24 | **Round 3** | Searched for markets where humans already pay and have a trust problem: Telegram signal groups, OpenClaw skills, Indian devs with declined cards, data annotation. | **Nundina** wins (52 points) |
| Oct 24 | **Round 4** | Two questions: how to solve cold start, and how to future-proof. Studied Numerai, Bittensor SN8, Collective2, Fat Pig Signals, eToro, Hyperliquid vaults, Kaito, Myfxbook. | Free-first bootstrap; shadow leaderboard; our own strategy agents; ERC-8004; generic resolver |
| Oct 24 | **Docs** | Wrote `Idea/` (10 docs + HSP guide) and the product README. Verified oracle and token addresses on mainnet. Commit `489281e`. | Spec frozen |
| Oct 26 | **Planning** | Created `Memory/` (this folder) and `Architecture/` (pages, backend, contracts, integrations, SDKs). | Build plan ready |

## Where the 8-day plan says we should be
The plan in `Idea/07-deliverables-and-plan.md` set D0 = Oct 24. **Today (Oct 26) is D2**, which was meant to be settlement contracts. No code exists in the repo yet, so we are about two days behind. See [06-status-and-open-questions.md](06-status-and-open-questions.md) for the catch-up plan.
