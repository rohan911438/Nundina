# 3. Research log: what we searched and what it changed

Full sources and links are in [`Idea/10-research-archive.md`](../Idea/10-research-archive.md). This file is the short version: **question → finding → effect on the product.**

## HashKey and HSP
| Question | Finding | Effect |
|---|---|---|
| What does HSP actually do? | Intent (EIP-712 Mandate) → settlement from payer's own wallet → Receipt verified. ACCEPT iff required ⊆ satisfied capabilities. Zero custody. | Every signal purchase is an HSP Mandate + Receipt |
| What can't HSP do? | No escrow, conditional release, refunds, splits, streaming. | Those become our contracts: `PerformanceEscrow`, `RevenueRouter` |
| What tools does HSP ship? | `@hsp/sdk`, `@hsp/mcp` (SpendGuard), `@hsp/devkit`, `@hsp/core`, `skills/hsp-pay`, hosted Coordinator | Use as many layers as possible for bonus points |
| Does HSP do compliance? | Yes: `attests:kyc`, `attests:sanctions` from an issuer | "Verified Provider" badge comes from the payment protocol |
| Is the SDK public? | No. Repo, Coordinator URL, API key, faucet shared "a few days" after sandbox deploys | **Blocker.** Build behind an interface with mock receipts |
| Which stablecoins? | USDT (6 dec, **no** EIP-3009, most holders), USDC.e (6 dec, **has** EIP-3009) | USDT for plain HSP path; USDC.e for x402 / gasless fast path |
| Which oracles are live? | APRO push (BTC/USD, HSK/USD, USDT, USDC) and Supra pull, verified by on-chain reads | APRO for expiry settlement, Supra for TP/SL touch proofs |
| How fine-grained is APRO? | 0.5% deviation or 1h heartbeat | Too coarse for touches, so Supra pull + challenge window |
| Gas cost? | 500 gwei; ~100k gas commit ≈ 0.05 HSK ≈ **$0.004** | We sponsor every provider's commits |
| Is ERC-8004 on HashKey? | `eth_getCode` at `0x8004A169…a432` returns no code | We deploy it: an ecosystem "first" |
| Who won HashKey hackathons before? | FlowLink (invoicing), hashpay (payroll), HSP Payment Agent (NL payments), SentryPay (auto-payout), Maneki AI | Avoid these categories; no one did outcome-conditional A2A |

## Agent-payments market
| Question | Finding | Effect |
|---|---|---|
| Is x402 real demand? | 165M+ payments, but volume fell ~92% from peak; ~half are wash loops; TRM: only 0.6–7.5% plausibly agentic | Pivot 2: don't sell to agents that don't exist yet |
| What wins agent hackathons? | Real vertical products (Dairy Price API, Mand(ate), Versus). 97% of HackMoney entries had agents, so agents alone don't differentiate | Lead with a real user problem |
| What standards matter? | ERC-8183 (job escrow), ERC-8004 (identity/reputation), AP2 (mandates), MPP (sessions) | ERC-8004 adopted; AP2 ideas in agent policy |
| What's unbuilt per academia? | Netting, credit, multi-hop obligations, delivery-coupled settlement | Multi-hop revenue routing kept as the A2A depth |

## The signal market (Round 3–4)
| Question | Finding | Effect |
|---|---|---|
| Do people pay for signals? | Paid Telegram tiers ₹700–7,000/month; Fat Pig ~60k free / ~8k VIP | Real buyers exist today |
| Is there a trust problem? | Indian scam cases (₹42 lakh Bengaluru, ₹6.5 lakh Chandigarh); CYFIRMA and Quick Heal reports | Core story for Mumbai judges |
| How do competitors verify? | Myfxbook (broker account), Collective2 (go-forward), Cornix (**backtested**), exchanges (custodial), Hyperliquid (vault PnL) | No one does signal-level, pre-move, pay-if-right |
| How did similar platforms cold-start? | Numerai free-first; Bittensor SN8 challenge period; Myfxbook free badge; Kaito died on platform risk | Free verification, probation, badge distribution, multi-client |
| Format of signals? | Cornix format is the de facto standard | Rule parser first, LLM fallback |
| Regulation? | SEBI finfluencer rules (2024) cover securities; crypto signals outside scope today | Position as verification infrastructure, not advice |
