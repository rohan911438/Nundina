# Prompt 15: Hardening, mainnet launch, demo and submission

## Context
Everything is built and running on testnet (01–14). Deadline **Sun Nov 1 2026, 21:30 IST** (internal target 18:00 IST). Read first:
- `Idea/07-deliverables-and-plan.md` (deliverables table, demo script)
- `Idea/09-risks.md`
- `contracts/SECURITY.md`, `contracts/DEPLOYMENTS.md`
- `Memory/06-status-and-open-questions.md`

## Goal
Ship safely to HashKey mainnet, generate real traction, and submit a complete, judge-friendly entry.

## Part A: Security pass (before mainnet)
Go through each item; fix with a test or write down why it's acceptable.
**Contracts**
- [ ] Reentrancy on every external transfer path (escrow settle/withdraw/refund, registry slash/withdraw, router).
- [ ] Replay: receipt hash, commit nonce, EIP-3009 nonce, credit signature domain (chainId + verifying contract).
- [ ] Rounding: fees, router splits, R-multiple; totals conserved.
- [ ] Funds can't get stuck: `claimRefund` reachable in every state; pause never blocks exits.
- [ ] Admin powers: only timelocked params; no path to user funds; roles granted exactly as `Deploy.s.sol` says (check on-chain with `cast call hasRole`).
- [ ] Oracle staleness and wrong-pair proofs revert.
- [ ] Run Slither (and Aderyn if available); triage every finding in `contracts/SECURITY.md`.
- [ ] Mainnet caps: max price per signal $5, max subscribers per signal 50.
**Off-chain**
- [ ] No plaintext signals, keys, salts or private keys in logs (grep logs from a full testnet run).
- [ ] Auth on every non-public endpoint; rate limits; Telegram webhook secret; internal secret rotated for prod.
- [ ] Separate wallets: deployer (cold after deploy), relayer, keeper, credit signer, agents. Each funded minimally. Credit signer key in a secret manager.
- [ ] Dependency audit (`pnpm audit`), pinned versions, `.env.example` complete, no secrets in git history (`git log -p | grep -i "private"` sanity check).

## Part B: Mainnet launch
1. Confirm deployer balance and estimated cost (prompt 05 script prints it).
2. `CONFIRM_MAINNET=yes pnpm contracts:deploy:mainnet` → verify on Blockscout → `pnpm contracts:export`.
3. Deploy services to production (Vercel for web; Railway/Fly for api, bot, keeper, indexer, mcp, agents; Neon/Supabase Postgres). Production env from a secret manager, `HSP_MODE=live` if credentials arrived, otherwise mock mode clearly stated in the README.
4. Point the bot webhook to production; set the Mini App URL in @BotFather.
5. Smoke test on mainnet with tiny amounts: provider commits → buy via HSP → settle WIN; another signal → settle LOSS → refund + slash. Record every tx hash and HSP payment id.
6. Monitoring: `/health` of each service on a simple status page; alerts (Telegram message to the team chat) for keeper balance, relayer balance, failed settlements, HSP verify failures.

## Part C: Traction (Oct 31 – Nov 1)
- Onboard 3–5 real Telegram providers (free verification). Track in `TRACTION.md`: providers, signals committed, purchases, HSP payments settled, refunds paid, total volume.
- Strategy agents running on mainnet from launch.
- Target from the plan: **≥ 10 real mainnet HSP purchases** with ACCEPT receipts.

## Part D: Demo assets
- **Pre-staged signals** with short expiry (e.g. 20–40 min) so a WIN and a LOSS settle during recording; plus one aggregator meta-signal.
- **Demo video ≤ 3 min** following `Idea/07-deliverables-and-plan.md` §7.4 exactly (hook → provider → subscriber agent → settlement → A2A → close). Show Blockscout and the HSP Explorer on screen.
- **Backup recording** of the full flow in case live demo fails on Demo Day.
- **Pitch deck 8–10 slides:** problem (India scam), solution, live demo screenshots, how it works, trust design, why HashKey (HSP, oracles, ERC-8004 first), traction numbers, business model, roadmap, team.

## Part E: Repository and submission
- Update `README.md`: live links (web, bot, MCP), **mainnet contract addresses table with Blockscout links**, HSP payment ids, architecture diagram, setup steps (`pnpm i`, `docker compose up`, env, run each app), test commands, demo video link, disclaimer.
- Update `Memory/01-timeline.md` and `Memory/06-status-and-open-questions.md` with what shipped and what was cut.
- Make sure `pnpm -r test` and `forge test` pass on a clean clone (CI via GitHub Actions: install, typecheck, test, forge test).
- Submit on DoraHacks before 18:00 IST: repo, video, deck, contract addresses, traction. Register for Demo Day (Nov 4, Mumbai).

## Done when
- [ ] All Part A boxes ticked or justified in writing.
- [ ] Mainnet contracts verified; production services green.
- [ ] ≥ 10 mainnet HSP purchases, at least one refund and one aggregator multi-hop payout on-chain.
- [ ] Video, deck, README, TRACTION.md complete; submission confirmed before 18:00 IST Nov 1.
