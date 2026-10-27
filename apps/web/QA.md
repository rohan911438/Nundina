# Manual QA: wallet flows and Telegram Mini App

Automated coverage: `test/encKey.test.ts` (key derivation, decrypt round-trip, field and policy
validation) and `e2e/wallet.spec.ts` (ConfirmSignal, BuyFlow, Agents against anvil + API in mock HSP
mode). Run the e2e suite with:

```
pnpm --filter @nundina/api e2e:stack      # terminal 1: anvil :8545, API :8788, seed data
pnpm --filter @nundina/web e2e:wallet     # terminal 2: web :3001 with the mock wallet, then Playwright
```
The stack's seed data is single-use (the draft gets committed, the signal bought): restart it before
each run.

What follows needs real devices and testnet funds (see `NEEDS-FROM-USER.md` items 4, 10, 15).

## Setup
- [ ] `NEXT_PUBLIC_REOWN_PROJECT_ID` set; the Reown dashboard allows the web origin
- [ ] Bot token set, bot menu button / deep links point at `<site>/tg/*`
- [ ] Test wallet on HashKey testnet with ~0.05 HSK and test USDT; provider wallet with a bond
- [ ] A test channel with the bot as admin

## Buyer, phone, inside Telegram (iOS and Android)
- [ ] Tap **Buy** under a locked card → bot DM → **Open** → `/tg/buy/:id` opens full-height in Telegram's theme
- [ ] Connect: AppKit opens; pick a mobile wallet; the deep link returns to Telegram
- [ ] Wrong network → "Switch to HashKey Chain Testnet" works
- [ ] Sign in (SIWE) → the API links the Telegram id to the wallet (`/my` in the bot now shows purchases)
- [ ] "Create decryption key" → one signature
- [ ] Balances of both tokens shown; capacity shown; insufficient balance blocks Pay with a message
- [ ] Pay → mandate signature → transfer → Paid → Verified by HSP (payment id link) → Credited (tx link) → Unlocked
- [ ] **Time from tapping Buy to seeing the levels: ____ s (target < 60 s)**
- [ ] Reject in wallet → "You cancelled the request in your wallet." and Pay works again
- [ ] Close and reopen `/tg/my` → the signal decrypts again without new signatures (same session)
- [ ] New session → one signature re-derives the same key; old purchases still decrypt
- [ ] After settlement: ✅ / ❌ badge in `/tg/my`, refund shown on a loss
- [ ] Opening `/tg/buy/:id` in a normal browser redirects to `/s/:id`

## Provider
- [ ] `/start` → I post signals → handle → Register: two transactions (ERC-8004 identity, registry)
- [ ] Get link code → post `/link CODE` in the channel → checklist shows "Telegram channel linked"
- [ ] Deposit bond (approve + deposit) → capacity = free bond ÷ default price
- [ ] Post a signal in the channel → bot DM → **Confirm** → `/tg/confirm/:id` shows the parsed fields large
- [ ] Edit a level so TP is on the wrong side → inline error, Lock it disabled
- [ ] **Lock it** → sign → commit tx link → MainButton "Close" closes the Mini App; locked card appears in the channel
- [ ] Dashboard: signal under Live; after expiry under Awaiting reveal; after settlement under Settled, earnings update
- [ ] Request withdraw → button shows the 7-day countdown

## Agents
- [ ] Create agent → API key shown once; agent wallet address with explorer link
- [ ] Send USDT to the agent; balance updates
- [ ] Edit policy; pause → the execution agent (prompt 13) logs no further buys; resume
