# Memory: how we got here

This folder is the project's memory. It records **why** Nundina exists in its current form: the constraints we started with, every idea we looked at, what we searched, what we rejected and why, and the pushback that changed direction.

Read it when you (or a new teammate, or an AI assistant) need to understand a decision without re-doing the research.

> The *what* lives in [`Idea/`](../Idea/README.md) (the product) and [`Architecture/`](../Architecture/README.md) (the build plan).
> The *why* and *how we got there* live here.

## Files

| # | File | What's inside |
|---|---|---|
| 1 | [01-timeline.md](01-timeline.md) | The journey, day by day and round by round |
| 2 | [02-ideas-explored.md](02-ideas-explored.md) | Every idea we considered, with scores and the reason it won or lost |
| 3 | [03-research-log.md](03-research-log.md) | What we searched, what we found, and what each finding changed |
| 4 | [04-decisions.md](04-decisions.md) | Key decisions in "decision / why / alternatives" form |
| 5 | [05-pivots-and-feedback.md](05-pivots-and-feedback.md) | The feedback that forced each pivot, and what we learned |
| 6 | [06-status-and-open-questions.md](06-status-and-open-questions.md) | Where we are now, blockers, and unanswered questions |

## The story in 60 seconds

1. **Start (Oct 23 2026).** HashKey Chain Horizon Hackathon, Mumbai edition, Track 2: *Agent Payments & A2A Settlement*. Must use **HSP**, must deploy on **HashKey mainnet**, deadline **Nov 1, 21:30 IST**.
2. **Round 1: infrastructure ideas.** Agent escrow, x402 pay-per-call marketplace, agent spend wallet. Best: "Compliant Agent Commerce" (ERC-8183 escrow + ERC-8004 + HSP).
3. **Pushback:** "escrow, spend wallets and pay-per-call are too basic and already built."
4. **Round 2: frontier ideas.** AgentCCP (a multilateral netting clearing house for agents), proof-of-delivery, agent credit, private payments. AgentCCP scored highest.
5. **Pushback:** "AgentCCP is too niche and futuristic. Where do users come from tomorrow?"
6. **Reality check:** real agentic payment demand is tiny (0.6–7.5% of x402 is actually agentic). New rule: **start from humans who already pay and have a trust problem.**
7. **Round 3: markets with real users.** Telegram crypto signal groups (huge, scam-ridden, India-relevant), OpenClaw skills, a stablecoin AI-API gateway. **Nundina won (52 points).**
8. **Round 4: hardening Nundina.** Cold start (free first, pay-if-works later, shadow leaderboard, our own strategy agents) and future-proofing (EIP-712 signal object, ERC-8004 reputation, generic resolver).
9. **Oct 24:** product docs written and committed (`Idea/`).
10. **Oct 26:** this memory folder and the detailed architecture (`Architecture/`).
