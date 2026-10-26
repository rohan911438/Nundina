# 5. Pivots and the feedback behind them

## Pivot 1: "Too basic, already built"
- **What we had:** Compliant Agent Commerce (ERC-8183 escrow + ERC-8004 + HSP + KYC hook).
- **Feedback:** escrow, spend wallets and pay-per-call are too basic and already exist.
- **What we did:** went looking for what is genuinely *unbuilt*: academic surveys on A2A payments, x402 attack research, TradFi netting.
- **Lesson:** a component is not a product. Escrow and spend limits are now *parts* of Nundina, not the pitch.

## Pivot 2: "Too niche and futuristic. Where are the users tomorrow?"
- **What we had:** AgentCCP, a netting clearing house for agent economies.
- **Feedback:** nobody would use it tomorrow.
- **What we did:** checked real demand. TRM Labs said only 0.6–7.5% of x402 payments are plausibly agentic; Visa's CEO said autonomous payments aren't adopted yet.
- **New rule:** *start from humans who already pay money and have a trust problem. Agents and A2A settlement are how we solve it, not the pitch.*
- **Lesson:** sophistication without users loses to a real problem with a sophisticated solution.

## Round 4 questions (not a pivot, a stress test)
1. **"Nobody will pay before there's public validation."**
   → Free first. The provider is the first customer and pays nothing. Shadow leaderboard from public channels on day 1. Probation before paid signals. A subsidy pool covers first refunds.
2. **"How does this survive the future?"**
   → Signal as an EIP-712 standard object, ERC-8004 portable reputation, payment-rail agnostic, generic outcome resolver (v3), agent alpha exchange (v4), reputation as credit (v5).

## Patterns worth remembering for future decisions
- Ask "who uses this **tomorrow**?" before "how clever is it?"
- Check past winners of *this* hackathon; don't repeat them.
- Verify chain facts on-chain (we found ERC-8004 missing and USDT lacking EIP-3009 this way).
- Every trust claim needs a mechanism (escrow, oracle, bond, open-source scoring), not a promise.
