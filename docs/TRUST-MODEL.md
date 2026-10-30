# Product and trust model

## In one line

Nundina is a marketplace where trading signals are **locked on-chain before the move**, **paid for through HSP into escrow**, and **settled by an oracle**. If the call is right, the provider is paid. If it is wrong, the buyer is refunded.

## Who uses it

| User | What they want | What Nundina gives them |
|---|---|---|
| **Signal provider** (human trader, Telegram channel owner, or AI strategy agent) | Prove they are legitimate, grow paid sales, get paid | A free, unforgeable track record, a verified channel badge, and paid signals with automatic settlement |
| **Subscriber** (retail trader) | Signals that work, and no scams | A refund when wrong, a graded public history, and an open score |
| **Execution agent** (acting for a subscriber) | Buy signals within the user's limits | Per-signal payments under a signed budget and spend rules, an MCP API |
| **Aggregator agent** | Buy many signals, blend them, resell | Upstream signals bought agent-to-agent, with revenue routed back to the original providers on-chain |

## Lifecycle of a signal

1. **Draft.** The provider writes the signal as usual, for example `BTC LONG entry 81,500 TP 84,000 SL 80,200 valid 24h`, in their Telegram channel or on the web. The bot parses it (Cornix-style rules first, an LLM as fallback) and asks the provider to confirm.
2. **Commit.** The provider signs an EIP-712 authorization. Our relayer writes `commitHash = keccak256(signal + salt)` to `SignalBook`, with the market, expiry and price. The signal body is encrypted with a fresh per-signal key. **From this moment the signal cannot be changed or deleted.** The provider pays no gas.
3. **Buy.** A subscriber or agent signs a Payment Mandate and pays USDT/USDC into the escrow. After the payment is verified, the signal key is wrapped to the buyer's encryption key and the signal is decrypted on their device.
4. **Live.** The keeper watches exchange prices. When TP or SL is touched, it submits an oracle price proof. A 10-minute challenge window lets anyone prove that the other level was touched earlier.
5. **Settle.** `PerformanceEscrow.settle(signalId)`:
   - **WIN:** the provider is paid (minus a 10% protocol fee), through `RevenueRouter` if the signal has upstream providers.
   - **LOSS:** every buyer is refunded in full and receives a slice of the provider's bond.
   - **VOID:** a limit signal whose entry was never reached is refunded without a slash.
6. **Reveal.** The plaintext and salt are published on-chain, so anyone can check the hash. If the provider does not reveal within 6 hours of the deadline, **the signal counts as a loss.**
7. **Score.** The profile and leaderboard update, and feedback is written to the **ERC-8004 Reputation Registry**.

## The trust design

One lucky call proves nothing, and a trader should not have to trust the provider *or* us. Seven rules handle this.

### 1. You get a refund, so you don't need trust
Payment sits in escrow and returns automatically if the call is wrong. If settlement is late by 24 hours (for example, an oracle outage), **anyone** can trigger the refund, so funds never get stuck.

### 2. Every call counts
- Once a signal is committed it is scored. There is no delete and no edit.
- An unrevealed signal is an automatic loss. This removes the trick of posting many contradictory calls and only showing the winners.
- Providers who want to practise get **practice signals** that are clearly labelled and never sold.

### 3. Skill, not luck
- **Sample size first.** No ranking below 30 settled signals. We rank on the **Wilson lower bound** of the win rate, so "3 out of 3" ranks below "60 out of 100".
- **Expectancy in R** (average gain per unit of risk), not win rate. A tiny take-profit with a huge stop-loss has a high win rate and bad expectancy, and the score shows it.
- **Alpha vs BTC.** Every call is compared with simply holding BTC over the same window. If the whole market went up, calling "long" is not skill.

### 4. Providers put money on the line
- Each provider can post a **bond**. On a loss, a slice equal to the signal price goes to each buyer.
- With signal price `p`, protocol fee `f` and slash per buyer `s`, a provider posting coin-flip signals expects `0.5·p·(1−f) − 0.5·s` per buyer. With `s ≥ p` this is negative, so **random or "both sides" posting loses money by design.**
- Each paid buyer locks `p` of bond, so a provider can only sell as many seats as their bond covers.

### 5. No fake entries
- The entry is checked against the oracle at commit. If the TP/SL levels don't bracket the market price, the signal becomes a **limit signal** that only goes live once the entry is touched.
- If one price bucket spans both TP and SL, it counts as **SL**, the worse outcome for the provider.

### 6. Verified identity
- A provider proves admin rights over their Telegram channel or group with a one-time code before it is linked.
- Lookalike channel names are flagged to buyers.
- Every provider has an ERC-8004 identity, so their record is portable and tied to one identity.

### 7. You don't have to trust us
- Funds are held by the escrow contract, not by the team.
- Outcomes come from oracle prices, not from us.
- The scoring code is open source, and anyone can recompute any profile from chain data. The MCP tool `verify_track_record` does exactly that.
- Every contract's admin is a timelock, and there is no admin path to user funds.

## From watcher to paying user

1. **Watch for free.** Every signal goes public after it settles, so anyone can follow a graded record as it grows.
2. **Free signals.** Providers can publish free signals that unlock in one tap and still count toward their record.
3. **Pay per signal.** Once a provider has a record, a bond and a score, the decision to buy is based on data, not screenshots.
4. **Delegate to an agent.** Set a budget, for example "at most $5 a day, only providers with a score above 60", and let an execution agent buy for you.

## Stated trust assumptions

- **The key service sees plaintext signals** before they are revealed. It handles confidentiality only and never touches funds. Threshold encryption or a TEE is on the roadmap.
- **Payment verification** is done by our credit signer after checking the transfer on-chain. The contract interface (`ICreditVerifier`) lets an on-chain HSP receipt check replace it.
- **Oracle correctness** comes from APRO and Supra on mainnet. On testnet, the keeper feeds a mock price adapter from exchange prices.
