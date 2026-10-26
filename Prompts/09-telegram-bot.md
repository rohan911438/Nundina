# Prompt 09: Telegram bot

## Context
API with commit relay (06) and purchases (07) exists. Read first:
- `Idea/01-idea-and-trust.md` §1.3–1.4, §1.6
- `Architecture/02-frontend-pages.md` §2.3–2.4 (Mini App screens, commands, automatic messages)
- `Architecture/01-how-it-works.md` §1.2–1.3
- `Idea/06-tech-stack.md` (signal parsing row)

## Goal
Providers keep posting in their channel as usual; the bot turns each post into a confirmed on-chain commit. Subscribers buy from a button under the post and receive the key in DM. Results are posted back automatically.

## Architecture
```
apps/bot/
├── src/
│   ├── index.ts              grammY bot, webhook (secret token) in prod, long polling in dev
│   ├── env.ts
│   ├── api.ts                typed client for apps/api (internal secret)
│   ├── parser/
│   │   ├── cornix.ts         rule-based parser
│   │   ├── llm.ts            Claude Haiku structured extraction (JSON schema)
│   │   └── index.ts          rules first, LLM fallback, both → zod Signal draft
│   ├── handlers/
│   │   ├── channelPost.ts    detect signals in channels where bot is admin
│   │   ├── commands.ts       /start /connect /link_channel /bond /signals /buy /my /agent /help
│   │   └── callbacks.ts      inline button actions
│   ├── notify/               consumers of pg-boss jobs: locked, keyDelivered, result, revealReminder
│   ├── i18n/en.ts            all user-facing copy (add hi.ts later)
│   └── cards.ts              message templates
└── test/
```
Plugins: `@grammyjs/conversations`, `@grammyjs/ratelimiter`, `@grammyjs/auto-retry`, session in Postgres.

## Parser
**Cornix-style rules** handle common forms, e.g.:
```
#BTC/USDT LONG
Entry: 81500 - 81200
Targets: 82500 - 84000
Stop: 80200
```
and one-liners like `BTC LONG 81.5k TP 84k SL 80.2k 24h`. Normalize: pair → market id (only supported markets: BTC/USD, HSK/USD; else reply "market not supported yet"); `k` suffix; entry range → midpoint; multiple targets → **first target** as TP (state this in the confirm message); default validity 24 h if missing.

**LLM fallback** (`@anthropic-ai/sdk`, model `claude-haiku-5-5`): only if rules fail and the message looks like a signal (contains a supported ticker and a side word). Use tool-use / JSON schema output with fields `{market, side, entry, takeProfit, stopLoss, validHours, confidence}`; reject when `confidence < 0.7`. Timeout 8 s. Never commit LLM output without the provider's confirmation.

Run the shared zod validation (geometry, R:R ≥ 1). On failure, DM the provider why.

## Provider flow
1. `/link_channel`: bot explains "add me as admin with 'post messages' right", then the provider forwards any channel message or sends `@channel`; bot checks admin status via `getChatMember`, links channel via `POST /providers/link-telegram`.
2. Channel post detected → parse → `POST /drafts` → DM the provider: parsed fields + buttons **Confirm & lock** (opens Mini App `/tg/confirm/:draftId`) / **Edit** / **Ignore**.
3. After commit (API job `notify.locked`): bot **replies in the channel** under the original post with a locked card:
   `🔒 Locked on HashKey · BTC LONG · expires 24h · price 0.50 USDT · refund if wrong` + buttons **Buy** (Mini App `/tg/buy/:id`) and **Proof** (signal page URL).
4. Reveal reminder DM 1 h before reveal window closes if not revealed (normally automatic).

## Subscriber flow
- `/start` deep links: `start=buy_<id>`, `start=p_<handle>`.
- `/connect` → Mini App `/tg/connect` (wallet + encryption key registration).
- Buy happens in the Mini App (prompt 12). After `notify.keyDelivered`, DM: "Your signal is unlocked" + button **Open** (Mini App `/tg/my`). The bot never sends plaintext signals in chat.
- `/my`, `/signals` (live signals from followed providers), `/agent` (status, pause/resume via API).

## Result cards (`notify.result`)
Reply in the channel under the locked card and DM each buyer:
`✅ BTC LONG hit TP · +1.9R · committed 14:02, before the move · Provider paid` or
`❌ BTC LONG hit SL · −1R · Subscribers refunded + 0.50 USDT each from bond`, with Blockscout links. Attach the OG image `/api/og/signal/:id` when the web app exists.

## Safety
- Verify webhook secret header. Rate-limit commands per user.
- Only act on channels linked to a registered provider.
- Escape all user text (MarkdownV2/HTML). Handle edited channel posts: **edits after commit are ignored** and the bot replies "already locked; edits don't change the committed signal".
- Copy includes the disclaimer on `/help` and the first DM.

## Tests
- Parser: 30 fixture messages (Cornix formats, one-liners, Hinglish noise, non-signals) with expected output; LLM path mocked.
- Handlers with grammY's test utilities or by faking updates: channel post → draft created; non-admin channel ignored; edited post after commit → message.
- Notification templates snapshot-tested.

## Done when
- [ ] In a real test channel on testnet: post → confirm → locked card appears with a Blockscout link.
- [ ] A second account buys via the button and gets the unlock DM.
- [ ] After settlement, result card appears under the post.

## Out of scope
Mini App UI itself (12). Shadow scraping of public channels (stretch).
