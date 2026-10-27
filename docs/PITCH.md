# Pitch deck outline (10 slides)

Numbers in _italics_ get filled in from `TRACTION.md` and Blockscout on submission day. Use screenshots of the real product only, no mockups.

1. **Title.** Nundina: pay only when the call is right. Verified, pay-if-right trading signals, settled agent-to-agent on HashKey Chain through HSP. Track 2 (Agent Payments & A2A Settlement).
2. **Problem: India's signal-group scams.** Paid Telegram VIP groups cost ₹700–7,000 a month and run on screenshots. Reported losses include ₹42 lakh in Bengaluru and ₹6.5 lakh in Chandigarh. Buyers have no way to check a track record and no recourse when the calls are wrong.
3. **Solution.** Providers keep posting in their channel. The bot commits each call on-chain *before* the move (commit-reveal, encrypted). Buyers pay through HSP into an escrow: a WIN pays the provider, a LOSS refunds the buyer plus a slice of the provider's bond. Every call counts, so nobody can cherry-pick.
4. **Live demo (screenshots).** Telegram lock card → Blockscout commit tx → HSP mandate and ACCEPT receipt → decrypted signal in the Mini App → settlement WIN and LOSS txs → aggregator `Routed` payouts → leaderboard.
5. **How it works.** Architecture diagram from the README: SignalBook, PerformanceEscrow, OutcomeResolver (APRO push + Supra), RevenueRouter, ProviderRegistry, ERC-8004. Off-chain: API, bot, keeper, indexer, agents, MCP.
6. **Trust design.** No admin path to user funds; a timelock holds every parameter; pause never blocks exits; `claimRefund` works after 24 h no matter what. The oracle has a challenge window, and a credit signer can't mint (escrow balance ≥ liabilities, single-use receipts). Slither triaged, 112 Foundry tests including invariants. Mainnet caps are $5 per signal and 50 subscribers.
7. **Agents and A2A.** Three strategy agents and an execution agent with a spend policy. An aggregator buys the top signals, blends them and sells a meta-signal; on a WIN the RevenueRouter pays the upstream providers automatically. An MCP server lets any Claude or AgentKit agent verify a track record (x402, paid per call) and buy a signal.
8. **Why HashKey.** HSP for compliant agent payments, the HSP KYC attestation for the Verified badge, APRO and Supra oracles on-chain, low gas, and the first ERC-8004 identity and reputation deployment on HashKey.
9. **Traction and business model.** _N providers, N signals, N HSP purchases, N refunds, $N volume_ (mainnet, hackathon week). Revenue: a 10% fee on winning payments only, a premium data API (x402), and KOL verification for exchanges. Unit economics: $0.50 × 50 buyers × 55% hit rate gives $1.38 in fees per signal, against about $0.01 of gas.
10. **Roadmap and team.** Next: threshold/TEE encryption, any verifiable prediction (funding rates, prediction markets), agent credit backed by reputation, and moving the timelock to a multisig. Team: _names, roles_. Ask: _what we want from HashKey (HSP mainnet, ecosystem intros)_.

Backup slide: the risk table (oracle, credit signer, key service, regulation) from `Idea/09-risks.md`.
