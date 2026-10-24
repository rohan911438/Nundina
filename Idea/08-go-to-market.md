# 8. Go-to-Market, Business Model and Future

## 8.1 The cold-start problem
Nobody pays a new platform with no history, and Telegram groups grow only after public validation. So **we don't ask anyone to pay first.** The **provider is the first customer, and they pay nothing.** Proof is what sells their VIP tier.

## 8.2 Bootstrap path: free first, pay-if-works later
| Phase | What happens | Who pays |
|---|---|---|
| **0. Shadow leaderboard** (day 1, no signups) | We read public signal channels, parse each call, and score it against price history. Profiles are labelled "observed, not committed". Good channels get invited to claim their profile; bad ones face public pressure. | Nobody |
| **1. Free verification** | A provider adds the bot. Every signal is committed on-chain with gas sponsored by us (about $0.004 each). They get a "Verified" profile link and badge to post in their *own* channel, so their audience becomes our distribution. | Nobody |
| **2. Probation** | After 30 days or 50 signals with a positive score, pay-if-works unlocks (the same model as Bittensor SN8's challenge period). | Nobody |
| **3. Pay-if-works** | Subscriber agents pay per signal into escrow. A subsidy pool covers the first N refunds for new users. | Subscribers, and only for winning signals |
| **Always on** | Our 3 strategy agents post from day one, so the marketplace is never empty. Every signal goes public after expiry, giving a stream of graded calls to share. | — |

## 8.3 Distribution channels
1. **Providers' own channels:** badge posts and "verified by Nundina" links. This is the Myfxbook playbook.
2. **Shareable graded-call cards:** an image auto-generated for each settled signal ("✅ BTC LONG +3.1%, committed before the move").
3. **Indian crypto communities and scam-awareness angle:** partner with exchanges' India teams and crypto YouTubers who already warn about scams.
4. **Agents:** the MCP listing and the HashKey AgentKit example, so builders' agents become buyers.
5. **The HashKey ecosystem:** Atlas grant, HashKey community channels, and Demo Day exposure.

## 8.4 Business model
| Revenue | How |
|---|---|
| **Performance fee** | 10% of each *winning* signal payment. We earn only when users get value |
| **Premium data API** | Agents and funds pay per call (x402/HSP) for verified scores and history |
| **KOL verification for exchanges and projects** (B2B) | Exchanges and token projects spend heavily on KOL marketing. Verified accuracy scores help them choose KOLs |
| **Pro provider tools** | Analytics, a white-label VIP bot, multi-channel management |

Unit economics: say a signal costs $0.50 and has 100 subscribers. At a 55% hit rate that is $27.50 gross per signal and $2.75 in fees, against about $0.01 of gas and settlement costs. Margins are very high, and the cost of a refund falls on the provider's revenue, not on us.

## 8.5 Future-proofing roadmap
| Horizon | What | Why it holds up |
|---|---|---|
| v1 (hackathon) | Telegram + web, HSP payments, APRO/Supra settlement, ERC-8004 reputation, MCP | — |
| v2 (3 months) | Threshold encryption (Lit) or TEE key service; more markets; HSP devkit "conditional-release" adapter; KYC-gated pro tiers | Removes our trust in the key service |
| v3 (6–12 months) | **Generic outcome resolver:** pay-if-right for any verifiable prediction (prediction-market outcomes, funding rates, sports, macro data) | Grows from "signals" to "verified predictions of anything" |
| v4 | **Agent alpha exchange:** trading agents buy and sell predictions from each other through HSP and x402, ranked by ERC-8004 reputation | Agents are becoming the main traders (about 30% of Polymarket activity by some estimates) |
| v5 | **Reputation as credit:** verified track records used to underwrite agent credit lines and provider capital | The unforgeable history becomes collateral |

**Design rules that keep it future-compatible:**
- **The signal is a standard object:** an EIP-712 typed struct that any agent can verify.
- **Payment-rail agnostic:** HSP today; x402 and AP2 mandates through HSP's AP2 alignment.
- **Reputation is portable:** ERC-8004, not a private database.
- **Frontends are replaceable:** Telegram is one client, and the protocol lives on-chain. This is the Kaito lesson: a platform rule change can't kill the product.
- **The moat is the data:** a history of calls committed before the move can't be forged afterwards, so a competitor that starts later can't recreate it.
