# 2. Every idea we explored

Scores are the ones we used at the time. Columns changed between rounds as our criteria changed, which itself is part of the story: Round 3 added **"users on day 1"** as the first column.

## Round 1: infrastructure on top of HSP
| Idea | Judge fit | Feasible (7d) | Demo | Total | Fate |
|---|---|---|---|---|---|
| **Compliant Agent Commerce**: ERC-8183 job escrow + ERC-8004 identity/reputation + HSP settlement + KYC hook + MCP | 10 | 8 | 9 | **27** | Round 1 winner. Dropped in pivot 1 as "escrow is basic" |
| AP2 Intent-Mandate wallet: user-signed budget/scope enforced on-chain over every HSP mandate | 8 | 8 | 7 | 23 | Folded in as a module; idea survives as Nundina's execution-agent policy |
| Compliant x402 tool marketplace (MCPay-style) | 7 | 9 | 7 | 23 | Crowded, close to past winners. Survives as Nundina's x402-gated MCP server |
| HSP session/streaming adapter (MPP-style) | 8 | 5 | 8 | 21 | Too risky for 8 days |
| On-chain agent spend-policy wallet | 6 | 8 | 6 | 20 | Feels like plumbing, weak demo |

## Round 2: frontier ("what nobody has built")
| Idea | Novelty | Depth | Judge fit | Feasible | Demo | Total | Fate |
|---|---|---|---|---|---|---|---|
| **AgentCCP**: multilateral netting clearing house for agents (margin, Merkle-rooted netting cycles, challenge window, default waterfall, custom HSP netting adapter) | 9 | 9 | 10 | 7 | 9 | **44** | Round 2 winner. Dropped in pivot 2: no users today |
| Proof-of-Delivery settlement (zkTLS/TEE proof gates payment) | 9 | 10 | 8 | 5 | 8 | 40 | Too hard in 8 days |
| Agent credit network (revenue-based financing against HSP receipts) | 8 | 8 | 8 | 7 | 7 | 38 | Moved to Nundina's v5 roadmap ("reputation as credit") |
| Private compliant payments (ZK KYC proofs, stealth addresses) | 8 | 9 | 8 | 5 | 6 | 36 | Circuit work, weak demo |

## Round 3: markets with users on day 1
| Idea | Users day 1 | Novelty | Depth | Track 2 fit | Demo | Feasible | Total | Fate |
|---|---|---|---|---|---|---|---|---|
| **Nundina**: pay-if-right trading signals, committed on-chain, HSP escrow, oracle settlement | 9 | 9 | 8 | 8 | 10 | 8 | **52** | **Chosen** |
| SafeSkills: insured pay-per-use skill/MCP marketplace (bonds, auditor staking, royalty DAG) | 7 | 8 | 8 | 9 | 7 | 7 | 46 | Strong runner-up. Its bond-and-slash idea was borrowed |
| Stablecoin AI-API gateway for Indian devs with declined cards | 9 | 5 | 6 | 7 | 6 | 9 | 42 | Most users, least novel; OpenRouter already takes crypto |
| India data-annotation payouts | — | — | — | — | — | — | — | Demand side (AI labs) too hard to win in a hackathon |

## What each dead idea left behind in Nundina
| Dead idea | What survives |
|---|---|
| Compliant Agent Commerce | ERC-8004 first deployment on HashKey; KYC attestation badge; escrow with permissionless `claimRefund` |
| AP2 Intent Mandate | Execution agent policy (budget, min score, markets) + SpendGuard |
| x402 marketplace | MCP server gated by `x402Gate` |
| AgentCCP | Multi-hop revenue routing (`RevenueRouter`); challenge windows |
| Agent credit | v5 roadmap: track record as collateral |
| SafeSkills | Provider bond slashed on loss |
