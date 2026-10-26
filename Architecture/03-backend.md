# 3. Backend

## 3.1 Apps (pnpm monorepo)
| App | Runs as | Job |
|---|---|---|
| `apps/api` | Long-running HTTP server (Hono) | REST API, HSP integration, key service, sponsored relayer, scoring jobs |
| `apps/bot` | Long-running (grammY, webhook mode) | Telegram I/O, signal detection, parsing, notifications |
| `apps/keeper` | Long-running worker | Price watching, touch proofs, settlement, sweeps |
| `apps/indexer` | Long-running (Ponder) | Chain events → Postgres |
| `apps/mcp` | HTTP MCP server | Agent-facing tools, x402-gated |
| `agents/*` | Long-running workers | 3 strategy agents, execution agent, aggregator agent |
| `packages/shared` | Library | EIP-712 types, ABIs, scoring math, chain config, zod schemas |

## 3.2 REST API (`apps/api`)
Auth: wallet sign-in (SIWE) for web; Telegram `initData` HMAC check for Mini App; API keys for agents.

**Public (no auth)**
| Method | Path | Returns |
|---|---|---|
| GET | `/stats` | Totals for home and transparency |
| GET | `/providers` | Leaderboard (query: market, period, type, verified, observed, sort, limit) |
| GET | `/providers/:handle` | Profile + scores |
| GET | `/providers/:handle/signals` | Signal history |
| GET | `/signals` | Feed (query: status, market, provider) |
| GET | `/signals/:id` | Signal detail + proofs + upstream tree |
| GET | `/prices` | OHLC for charts (cached) |
| GET | `/contracts` | Addresses + ABIs |

**Provider**
| Method | Path | Does |
|---|---|---|
| POST | `/providers/register` | Creates profile; returns ERC-8004 register tx to sign |
| POST | `/providers/link-telegram` | Links channel via one-time code |
| POST | `/drafts` | (bot) store parsed draft |
| POST | `/drafts/:id/confirm` | Takes provider's EIP-712 sig → encrypt → relay `commit` |
| POST | `/signals/:id/reveal` | Manual reveal (normally automatic) |
| GET | `/me/provider` | Dashboard data |

**Subscriber / purchases**
| Method | Path | Does |
|---|---|---|
| POST | `/purchases` | Creates HSP payment intent for a signal; returns mandate to sign |
| POST | `/purchases/:id/submit` | Takes signed mandate + tx hash → Coordinator observe → verify → `creditPayment` |
| GET | `/purchases/:id` | Status (PENDING / ACCEPTED / CREDITED / KEY_SENT / SETTLED) |
| GET | `/purchases/:id/key` | ECIES-wrapped key (only to the buyer) |
| GET | `/me/subscriber` | Dashboard data |

**Agents**
| Method | Path | Does |
|---|---|---|
| POST | `/agents` | Create execution agent + policy |
| PATCH | `/agents/:id/policy` | Update budget, min score, markets |
| POST | `/agents/:id/pause` | Kill switch |
| GET | `/agents/:id/activity` | Log |

**Internal (service-to-service, shared secret)**
`POST /internal/hsp/webhook` (if Coordinator supports callbacks), `POST /internal/reveal-due`, `POST /internal/notify`.

## 3.3 Database (Postgres, 12 tables)
| Table | Key columns |
|---|---|
| `users` | id, wallet, telegram_id, pubkey (secp256k1, for ECIES), created_at |
| `providers` | id, user_id, handle, erc8004_id, payout_addr, channel_id, kyc_until, is_agent, is_practice, default_price |
| `signal_drafts` | id, provider_id, raw_text, parsed_json, parser (rules/llm), status |
| `signals` | id (on-chain), provider_id, commit_hash, market, side, entry, tp, sl, valid_until, price, ciphertext, aes_key_enc, salt_enc, status, outcome, r_multiple, upstream_json |
| `purchases` | id, signal_id, buyer_user_id, agent_id, amount, token, hsp_payment_id, receipt_hash, outcome_class, credited_tx, status |
| `key_deliveries` | purchase_id, wrapped_key, delivered_at |
| `settlements` | signal_id, outcome, proof_tx, settle_tx, payout, refunds_total, slash_total |
| `provider_scores` | provider_id, period, n, wins, wilson_lb, expectancy_r, alpha_btc, max_dd, follower_pnl, score |
| `agents` | id, owner_user_id, wallet, type, policy_json, paused, spent_today |
| `agent_actions` | id, agent_id, signal_id, decision, reason, purchase_id, fill_json |
| `shadow_channels` / `shadow_calls` | public channel scraping and scored calls (stretch) |
| `chain_events` | Ponder-managed tables (one per event) |

Sensitive columns (`aes_key_enc`, `salt_enc`) are encrypted at rest with a master key from env (KMS later).

## 3.4 Background jobs
| Job | Where | Trigger | Does |
|---|---|---|---|
| Price watch | keeper | Binance WS stream | Detect TP/SL crossings for live signals |
| Touch prover | keeper | Crossing detected | Fetch Supra proof → `proveTouch` |
| Expiry resolver | keeper | Every 1 min | `resolveAtExpiry` for expired signals |
| Settler | keeper | Challenge window over | `settle(signalId)` |
| Revealer | api | Signal settled | `reveal(plaintext, salt)` |
| Unrevealed sweep | keeper | Every 10 min | `markUnrevealed` past reveal window |
| Refund sweep | keeper | Every 10 min | `claimRefund` past max settle delay |
| Scoring | api | After each settlement + hourly | Recompute `provider_scores` |
| HSP retry | api | `RETRYABLE` outcome | Back-off retry observe/verify |
| Notifications | bot | Events from api | Lock cards, key DMs, result cards, reveal reminders |
| Strategy agents | agents | Every N min | Generate and post signals via API |

Queue: Postgres-backed (`pg-boss`), no Redis needed for the MVP.

## 3.5 Security essentials
- Relayer wallet holds only HSK for gas; it never holds user funds.
- Key service: master key in env; never log plaintext; wrapped keys only returned to the buyer's authenticated session.
- Verify every Telegram `initData`; verify every SIWE signature; rate-limit by user and IP.
- Pin the HSP adapter address once from `/chains`; verify receipts locally, never trust the Coordinator's status alone.
- Idempotency keys on `/purchases/:id/submit` and every relayed tx.
