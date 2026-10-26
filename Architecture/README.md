# Architecture: the detailed build plan

This folder turns the product design in [`Idea/`](../Idea/README.md) into a build plan: what runs where, which pages we build, which services and endpoints exist, which contracts and functions we write, which outside services we connect to, and which SDKs we install.

| # | File | What's inside |
|---|---|---|
| 1 | [01-how-it-works.md](01-how-it-works.md) | End-to-end: the layers, the main flows, frontend ↔ backend ↔ chain |
| 2 | [02-frontend-pages.md](02-frontend-pages.md) | **Every page** (web + Telegram bot + Mini App), MVP vs later, sections and data on each |
| 3 | [03-backend.md](03-backend.md) | Services, REST API endpoints, database tables, background jobs |
| 4 | [04-smart-contracts.md](04-smart-contracts.md) | Each contract's functions, events, state machine and parameters |
| 5 | [05-external-integrations.md](05-external-integrations.md) | Every outside service: what we use it for, what we need from it, status |
| 6 | [06-sdks-and-packages.md](06-sdks-and-packages.md) | SDKs and libraries per app, env variables, accounts checklist |
| 7 | [07-build-order.md](07-build-order.md) | What to build first, day by day from Oct 26 to Nov 1 |

## The numbers at a glance
| Thing | Count |
|---|---|
| Web pages | **13** total, **7 for MVP** |
| Telegram Mini App screens | **4** |
| Telegram bot commands | **9** |
| Smart contracts | **6** (+ 2 adapters) |
| Backend apps | **6** (api, bot, keeper, indexer, mcp, agents) |
| Database tables | **12** |
| External integrations | **14** (10 must-have) |
