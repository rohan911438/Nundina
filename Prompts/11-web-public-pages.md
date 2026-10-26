# Prompt 11: Web app foundation and public pages

## Context
API read endpoints exist with seed data (06). Read first:
- `Architecture/02-frontend-pages.md` (all of it; this prompt builds pages 1–4 and 13)
- `README.md` (copy, trust rules table, tagline)
- `Idea/01-idea-and-trust.md` §1.5 (the 7 trust rules)

## Goal
A fast, credible public site judges and subscribers land on: Home, Leaderboard, Provider profile, Signal detail, Legal. Plus the design system and shareable OG images.

## Architecture
```
apps/web/
├── app/
│   ├── layout.tsx                 fonts, theme, providers (QueryClient, wagmi/Reown – wired now, used in 12)
│   ├── page.tsx                   Home
│   ├── leaderboard/page.tsx
│   ├── p/[handle]/page.tsx
│   ├── s/[id]/page.tsx
│   ├── legal/page.tsx
│   ├── api/og/badge/[handle]/route.tsx
│   └── api/og/signal/[id]/route.tsx
├── components/
│   ├── ui/                        shadcn/ui primitives
│   ├── brand/                     Logo, Badge (Verified / Agent / Probation / Trades own calls)
│   ├── signal/                    SignalCard, SignalStatusPill, ProofBox, PriceChart (lightweight-charts), UpstreamTree
│   ├── provider/                  ProviderRow, ScorePanel, EquityCurve, FollowerStats
│   └── home/                      Hero, LiveTicker, HowItWorks, TrustRules, TopProviders, Numbers, ForAgents
├── lib/api.ts                     typed fetchers (types from packages/shared), TanStack Query hooks
├── lib/format.ts                  money (6 dec), price (8 dec), R, %, relative time, explorer links
└── tailwind.config.ts             tokens
```
Stack: Next.js (App Router, RSC for public pages), Tailwind, shadcn/ui, TanStack Query (client parts), lightweight-charts, `@vercel/og`.

## Design system
- Tone: trustworthy, data-first, not "crypto casino". Dark and light themes.
- Colour tokens: background, surface, text, muted, border, accent, **win** (green), **loss** (red), **locked** (amber), **void** (grey). Check contrast ≥ 4.5:1.
- Numbers in tabular mono. Every on-chain fact gets a small "↗ explorer" link.
- Mobile-first: most users arrive from Telegram on phones. 16 px side padding; tables become cards under 640 px.

## Pages (build exactly the sections in Architecture/02 §2.2)
**Home `/`:** Hero ("Pay only when the call is right", CTAs), LiveTicker (last 10 settled, auto-refresh 30 s), HowItWorks (Lock → Pay → Settle → Prove), TrustRules (7 cards), TopProviders (3), Numbers (`/stats`), ForAgents, Footer with contract links from `/contracts`.

**Leaderboard `/leaderboard`:** filters in URL query (market, period, type, verified, observed); sortable columns; probation rows unranked and visually separated; empty and loading states.

**Provider `/p/[handle]`:** header + badges + ERC-8004 link + bond; ScorePanel (score, Wilson LB, expectancy R, alpha, max DD, n); EquityCurve (cumulative R); FollowerStats; signal history (locked signals show 🔒 and a Buy button that links to `/s/[id]`); "Copy badge" (embed snippet for `/api/og/badge/[handle]`). Metadata/OG tags per provider.

**Signal `/s/[id]`:** state-driven layout for Locked / Unlocked (client-side, if the viewer bought it; leave a hook for prompt 12) / WIN / LOSS / Unrevealed / Void. PriceChart with entry/TP/SL lines **only after reveal**, commit-time marker, touch marker. ProofBox lists commit tx, commit time, commit hash, reveal tx, proof tx, settle tx, HSP payment ids (explorer links). UpstreamTree for aggregator signals. Buy box placeholder (wired in 12).

**Legal `/legal`:** verification infrastructure, not investment advice; providers responsible for their own compliance; risks.

## OG images
- Badge: provider handle, score, n signals, win-rate LB, "Verified by Nundina", QR or short URL.
- Signal: ✅/❌, market, side, R, "committed before the move at HH:MM". 1200×630, both cached.

## Quality bar
- Lighthouse mobile ≥ 90 performance and accessibility on Home.
- No layout shift on data load (skeletons sized to content).
- All data comes from the API; no hard-coded numbers except copy.
- Works with the API's seed data and later with real data unchanged.

## Tests
- Component tests (vitest + Testing Library) for SignalStatusPill states, ProofBox links, format helpers.
- Playwright smoke: Home loads, leaderboard filter changes URL, provider page renders, signal page renders in each state (use seed ids).

## Done when
- [ ] `pnpm --filter web dev` shows all five pages with seed data, on phone width and desktop.
- [ ] OG images render.
- [ ] Deployed preview on Vercel pointing at the dev API.

## Out of scope
Wallet flows, dashboards, Mini App (12).
