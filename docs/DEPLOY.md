# Deployment

Nundina runs on **HashKey Chain testnet (133)**. Mainnet needs an explicit go-ahead (see NEEDS-FROM-USER.md).

| Part | Host | URL |
|---|---|---|
| Web (Next.js, `apps/web`) | Vercel, project `nundina` | https://nundina-signals.vercel.app |
| API + Telegram bot + keeper | Render web service `nundina-api` (free) | https://nundina-api.onrender.com |
| Indexer (Ponder + projector) | Render web service `nundina-indexer` (free) | https://nundina-indexer.onrender.com/health |
| Postgres 16 | Render `nundina-db` (free, Singapore) | internal only |

Health: https://nundina-signals.vercel.app/status (every check, including keeper and indexer).

## How it fits the free tiers

Render's free web services get one instance with 512 MB, sleep after 15 minutes without inbound
traffic, and share 750 instance-hours a month per workspace. So:

- `scripts/render/supervise.mjs backend` runs the API (public `$PORT`), the bot (long polling, so
  no inbound port) and the keeper in one container. `supervise.mjs indexer` runs Ponder and the
  projector; Ponder stays on 127.0.0.1 and the supervisor answers Render's `/health`.
- Each app is a single `node --import tsx` process with a heap cap (≈320 MB for the backend,
  ≈370 MB for the indexer, measured). A crashed app restarts with backoff; the others keep running.
- Each service pings its own `RENDER_EXTERNAL_URL` every 10 minutes so it doesn't sleep. Two
  always-on services use ≈1,440 hours a month, more than the 750 free hours shared with every
  other free service in the workspace. Fine for the hackathon window; for longer, move the
  backend to a paid instance (Starter) or set `KEEP_AWAKE=0` on the indexer (it catches up from
  the last block when it wakes).
- Free Postgres expires 30 days after creation (2026-11-27). Upgrade it or dump and restore before then.
- Migrations run on every start of `nundina-api` (Render's pre-deploy step is a paid feature).

## Deploys

- **Render** auto-deploys both services on every push to `build/06-api-foundation`.
  Build: `npx -y pnpm@11.13.1 install --frozen-lockfile --prod=false`.
- **Vercel** builds from GitHub (root `apps/web`, production branch `build/06-api-foundation`).
  Only committed files are built. The browser calls the API through `/backend/*` (see
  `apps/web/next.config.ts`), so `API_URL` must be set at build time.

## Configuration

Secrets live only in Render's environment store (never in git). Production uses fresh
`INTERNAL_SECRET`, `SESSION_SECRET` and `KEY_SERVICE_MASTER_KEY` (not the local ones). The
testnet relayer, keeper and credit-signer keys are the funded testnet wallets, since the
contracts grant roles to those addresses. The deployer key is not on any server.

| Service | Notable settings |
|---|---|
| `nundina-api` | `CHAIN_ID=133`, `HSP_MODE=direct`, `PORT=10000`, `PUBLIC_API_URL`, `WEB_ORIGIN=https://nundina-signals.vercel.app` (SIWE domain and CORS), `WEB_URL`, `MINI_APP_URL=…/tg`, `STATUS_SERVICES`, `KEEPER_MIN_BALANCE_HSK=0.05` |
| `nundina-indexer` | `INDEXER_CHAIN_ID=133`, `INDEXER_DB_SCHEMA=ponder`, the same DB and secrets (the projector writes through the API's db client) |
| Vercel | `API_URL`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_CHAIN_ID=133`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_BOT_USERNAME` |

The bot's menu button opens `https://nundina-signals.vercel.app/tg` (set with `setChatMenuButton`).
Only one copy of the bot may poll at a time: stop any local bot while production runs.
