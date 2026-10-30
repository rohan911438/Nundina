# Go-to-market and business model

## The cold-start problem

Nobody pays a new platform with no history, and Telegram groups grow only after public validation. So **Nundina does not ask anyone to pay first.** The provider is the first customer, and they pay nothing: verified proof is what sells their paid tier.

## Bootstrap path: free first, pay-if-right later

| Phase | What happens | Who pays |
|---|---|---|
| **0. Observed profiles** | Public signal channels are parsed and scored against price history, labelled "observed, not committed". Strong channels are invited to claim their profile | Nobody |
| **1. Free verification** | A provider adds the bot. Every signal is committed on-chain with gas sponsored by us. They get a verified profile to share in their own channel, so their audience becomes our distribution | Nobody |
| **2. Free signals** | Providers publish free signals that unlock in one tap and still build their record | Nobody |
| **3. Pay-if-right** | Once a record and a bond exist, buyers and agents pay per signal into escrow | Buyers, and providers keep the money only for right calls |
| **Always on** | Our own strategy agents post from day one, so the marketplace is never empty | n/a |

## Distribution

1. **Providers' own channels:** verified-profile links and result cards posted by the bot. This is the Myfxbook playbook.
2. **Shareable result cards** for every settled signal: "committed before the move".
3. **India's crypto communities,** with a scam-awareness angle, through creators who already warn about fake "gurus".
4. **AI agents:** the MCP server makes every agent a potential buyer.
5. **The HashKey ecosystem:** grants, community channels and Demo Day.

## Business model

| Revenue | How |
|---|---|
| **Performance fee** | 10% of each winning payment (set on-chain, capped at 20% by code). We earn only when the buyer got value |
| **Data API** | Agents and funds pay per call (x402) for verified scores and history |
| **Verification for exchanges and projects** (B2B) | Verified accuracy scores help exchanges and token projects choose KOLs |
| **Pro provider tools** | Analytics, multi-channel management, verified-badge visibility |

**Unit economics.** A $0.50 signal with 100 buyers and a 55% hit rate earns $27.50 gross per signal and $2.75 in fees, against about $0.01 of gas. A refund costs the provider's revenue, not the protocol.

## Long-term direction

| Horizon | What | Why it holds up |
|---|---|---|
| **Launch** | Mainnet, HSP gateway payments, real providers | The track record starts compounding |
| **v2** | Threshold encryption or a TEE for signal keys; more markets; KYC-gated pro tiers | Removes trust in the key service |
| **v3** | **Generic outcome resolver:** pay-if-right for any verifiable prediction (prediction markets, funding rates, sports, macro data) | Grows from "signals" to "verified predictions of anything" |
| **v4** | **Agent alpha exchange:** agents buy and sell predictions from each other, ranked by ERC-8004 reputation | Agents are becoming the main traders |
| **v5** | **Reputation as credit:** verified track records underwrite agent credit lines and provider capital | An unforgeable history becomes collateral |

**Design rules that keep it future-proof:**
- **The signal is a standard object:** an EIP-712 struct any agent can verify.
- **Payment-rail agnostic:** HSP today; x402 and other mandate formats through the same interface.
- **Reputation is portable:** ERC-8004, not a private database.
- **Frontends are replaceable:** Telegram is one client; the protocol lives on-chain.
- **The moat is the data:** a history of calls committed before the move can't be forged afterwards, so a later competitor can't recreate it.
