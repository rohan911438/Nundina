# 10. Research Archive and Sources

This file holds all the background research, moved here from the old `research.md`, which has now been deleted. The full HSP developer guide is saved next to it as [hsp-developer-guide.md](hsp-developer-guide.md).

## 10.1 Sources from the final research pass (Oct 24 2026)
**Competitors**
- Myfxbook verification: https://www.myfxbook.com/help/?p=300 , https://forums.babypips.com/t/a-guide-to-using-and-recognising-myfxbook-accounts/52656
- Collective2: https://elitetrader.com/et/threads/how-does-collective2-work.229089/ , https://tearsheet.co/?p=4343
- Cornix marketplace (backtested stats): https://intercom.help/cornix/en/articles/5814936-marketplace
- Binance copy trading: https://www.theblock.co/post/290345/binance-spot-copy-trading · Bitget elite traders: https://www.bitget.com/support/articles/12560603887634 · Copy trading outcomes: https://www.kucoin.com/blog/is-crypto-copytrading-profitable-in-2026
- eToro Popular Investor: https://sacra.com/chat/h/d9dcbcc5-e54d-4699-b54a-c12461eb1977/ , https://help.etoro.com/articles/en_GB/Knowledge/what-is-etoro-s-popular-investor-program
- Hyperliquid vaults: https://tradingstrategy.ai/vaults/hyperdash-vault-1 , https://eco.com/support/en/articles/15197987-hyperliquid-vault-strategies-2026-hlp-and-user-vaults-explained
- Bittensor SN8 / Taoshi: https://www.prnewswire.com/br/comunicados-para-a-imprensa/os-principais-traders-participam-da-competicao-de-trading-descentralizado-da-taoshi-para-criar-via-crowdsourcing-estrategias-de-investimento-de-alto-desempenho-e-ganhar-uma-parte-do-pool-de-recompensas-de-mais-de-us-30-milhoes-302436734.html , https://www.bankless.com/de/bittensor-crypto-vaporware-tao.md
- Numerai: https://docs.numer.ai/ , https://medium.com/numerai/numerais-master-plan-1a00f133dba9
- Kaito: https://blockeden.xyz/blog/2026/04/18/kaito-yaps-attention-economy-infofi-meritocratic-influence/
- Fat Pig free vs VIP: https://dailycoin.com/crypto-signals-telegram-top-channels/

**HashKey**
- Oracle addresses (official docs): https://docs.hskchain.net/docs/Build-on-HashKey-Chain/Tools/Oracle · APRO Data Push: https://docs.apro.com/en/data-push/getting-started · Supra pull: https://docs.supra.com/oracles/data-feeds/pull-oracle
- On-chain reads, Oct 23–24 2026, via https://mainnet.hsk.xyz: APRO BTC/USD = $81,661.26; HSK/USD = $0.0873; gas price = 500 gwei
- Atlas grant program: https://prnewswire.co.uk/news-releases/hashkey-chain-launches-50-million-atlas-grant-program-to-empower-global-web3-developers-302330308.html

**Tech**
- grammY comparison: https://grammy.dev/resources/comparison
- Lit Protocol access control: https://developer.litprotocol.com/v2/accessControl/intro
- ERC-8004 deployments: https://docs.base.org/ai-agents/reference/contracts , https://docs.celo.org/build-on-celo/build-with-ai/8004 , https://www.alchemy.com/overviews/erc-8004

**Agents and markets**
- Agents on Polymarket: https://blockeden.xyz/blog/2026/01/25/prediction-markets-polymarket-kalshi-ai-agents/ , https://simplefunctions.dev/opinions/prediction-markets-information-finance-q2-2026

---

## 10.2 Full earlier research log (Rounds 1–4), moved here from research.md

# HashKey Horizon Hackathon: Track 2 Research (Agent Payments & A2A Settlement)

**Constraints:** must use HSP · contracts deployed on **HashKey Chain mainnet** · deadline **Nov 1 2026, 21:30 IST** · demo day Nov 4, Mumbai (in-person teams get priority) · extra points for officially recommended products/frameworks.

---

## Iteration 1: HSP (HashKey Settlement Protocol), primary source

Source: HSP Developer Guide embedded in https://hashfans.io (`/docs?id=HSP`; GitHub source `HashkeyHSK/hashkeydevhub/docs-source/contents/docs/HSP/index.mdx`, which is private/404). A full copy is saved in the scratchpad as hsp_guide.md.

### What HSP actually is
- A **verifiable, zero-custody settlement layer for stablecoin payments**. It is an extension of Google's **AP2** spec. HashKey joined the AP2 partner ecosystem on Oct 16.
- Three moves: **Intent** (the payer signs an EIP-712 *Mandate*), then **Settlement** (the payer's own wallet sends the ERC-20 transfer), then **Verification** (a verifier checks the *Receipt* against the mandate and a pinned policy, and "ACCEPT means ship").
- There are three wire objects: **Mandate** (signed by the payer), **Receipt** (signed by an adapter/observer) and **Attestation** (signed by an issuer, e.g. KYC or sanctions).
- The core rule: the verifier ACCEPTs **iff `requiredCapabilities ⊆ satisfiedCapabilities`**. Capabilities look like `proves:settlement-verified` and `attests:kyc`.
- Outcome classes are `ACCEPT / RETRYABLE / POLICY / PERMANENT`.

### Supported scenarios (this release)
1. Public payment via evm-transfer
2. Public payment via **Coinbase x402 v2** (HTTP 402, EIP-3009, gasless for the payer)
3. Compliant payment (KYC + sanctions attestations) via evm-transfer
4. Compliant payment over x402

### Tool stack (use as many layers as possible, since recommended tools earn points)
- `skills/hsp-pay`: an AI skill (quote, then user approval, then pay)
- `@hsp/mcp`: an MCP server with `hsp_quote / hsp_pay / hsp_status / hsp_verify`, plus a **SpendGuard** (per-tx cap, daily cap, recipient allowlist)
- `@hsp/sdk`: `HSPClient.pay()`, `payX402()`, `HSPVerifier.verify()`, and the `x402Gate` / `fetchWithX402` helpers
- `@hsp/devkit`: build and conformance-test **your own settlement adapter** (new rail or new proof), then register it in the Coordinator's trust set
- `@hsp/core`: primitives
- **Coordinator** (hosted): `POST /payments`, `/payments/:id/observe`, `GET /payments/:id/explain`, `/requirements`, `/chains`, `/stats`, `/explorer`

### Gaps and openings (where a project can add value)
- HSP is **one-shot, single-leg payments** only. It has no native **escrow, conditional release, streaming/metered billing, refunds, disputes, or multi-party splits**. Those must be built as contracts on HashKey Chain, which also satisfies the "deploy on mainnet" rule.
- Agent identity and reputation are mentioned in the marketing (a "digital identity layer") but there is no SDK surface for them, which leaves room for an ERC-8004-style registry.
- The adapter devkit is an underused, high-signal path. A **custom adapter** (e.g. "escrow-release adapter" or "streaming-voucher adapter") shows deep protocol integration.
- The SpendGuard is server-side and off-chain. An **on-chain spend-policy wallet** for agents would complement it.
- The sandbox is on `hashkey-testnet`, but mainnet contract deployment is required. Plan for both.

### Real-world HSP pilots (from press)
- eCandle: per-kWh solar electricity micro-settlement. Lingchu robots: robots with scoped payment permissions that pay for data APIs. ONERWAY: stablecoin-to-fiat off-ramp partner (Sep 2026).
- Sources: [TechFlow](https://techflowpost.com/en-US/article/31203), [Phemex](https://phemex.com/news/article/hashkey-unveils-hsp-protocol-to-power-ai-agent-economy-74466), [TradeInformer: ONERWAY](https://tradeinformer.com/payments/hashkey-hsp-onerway-stablecoin-fiat-offramps)

### Market signal
- x402 cleared 100M+ payments, but monthly volume fell about 92% from its peak ($5.15M to $1.19M, per OKX Ventures). The argument: **payment rails are commoditized, while settlement (escrow, atomicity, two-sided exchange) is the unbuilt layer.** ([dev.to](https://dev.to/barissozen/rails-are-not-settlement-what-the-92-x402-crater-tells-us-about-the-agent-economy-8fc); the author has a vested interest.)
- A previous HashKey hackathon build, **SentryPay**, did an autonomous on-chain HSP payout ([DoraHacks](https://dorahacks.io/build/46973/milestones)).

### Other HashKey ecosystem pieces (from the HashFans bundle)
- Mainnet RPC `https://mainnet.hsk.xyz`, explorer `https://hashkey.blockscout.com`, docs `https://docs.hsk.xyz`, faucet `https://faucet.hsk.xyz`
- HashKey fork of Coinbase **AgentKit** (`github.com/HashkeyHSK/agentkit`), Safe, APRO and Supra oracles, HSKSwap, Chainlink CCIP, KYC (`kyc-testnet.hunyuankyc.com`), NexaID, HashKey CaaS

---

## Ranked shortlist (working, updated each iteration)

| # | Idea | Judge fit | 7-day feasibility | Demo | Notes |
|---|---|---|---|---|---|
| 1 | **Agent escrow + verified release on HSP** (task marketplace where an agent hires an agent; funds are locked in a HashKey contract and released when the HSP verifier ACCEPTs and the deliverable check passes) | 9 | 8 | 9 | Fills HSP's biggest gap (no escrow) |
| 2 | **x402 pay-per-call API marketplace on HashKey** (paywalled agent tools via `x402Gate`, compliant mode, revenue dashboard) | 8 | 9 | 8 | Closest to the officially supported path; risk of being a commodity idea |
| 3 | **On-chain agent spend-policy wallet** (caps, allowlists, session keys) + `@hsp/mcp` | 7 | 8 | 7 | Complements SpendGuard |

(Still to research: x402 ecosystem, AP2, A2A/ERC-8004, MPP/streaming, past hackathon winners, products with traction.)

---

## Iteration 2: x402 ecosystem, A2A escrow standards, hackathon winners

### x402 (Coinbase, now x402 Foundation / Linux Foundation, Apr 2026)
- About 165M+ payments and about $50M cumulative A2A USDC volume by Apr 2026. Daily volume fell about 92% from the Dec 2025 peak, and **Artemis estimates about half of tx are wash loops**. The rail exists; real demand is the open question. ([gigs.sh field guide](https://gigs.sh/blog/agent-to-agent-payments), [CoinDesk via search](https://www.coindesk.com/tech/2026/05/08/ai-agents-fueled-a-frenzy-of-startup-building-at-the-consensus-miami-easya-hackathon))
- Big backers: Stripe (Base USDC in PaymentIntents, Feb 2026), AWS Bedrock AgentCore Payments (402 detection, time-bounded budget, sign, retry), Cloudflare, Fireblocks (May 2026), and Coinbase **batch settlement**. ([wavect comparison](https://wavect.io/blog/x402-payments-comparison-2026/), [Cointelegraph](https://cointelegraph.com/news/coinbase-launches-x402-batch-settlement-ai-payments))
- The de facto default stack is **MCP + x402 + USDC on Base**. 5 of 9 agent-task marketplaces tracked by gigs.sh use it.
- x402-for-MCP tooling: MCPay (pay-per-tool-call proxy), mark3labs/mcp-go-x402, Civic x402-mcp, PayMCP.

### Hackathon winners with agent payments (patterns that win)
- **Coinbase CDP "Agents in Action":** Cash Drive, Snack Money API, Infinite Bazaar (x402 + CDP Wallet), **MCPay.fun**, 1shot API. Themes: payroll, fee routers, pay-per-use marketplaces. ([Coinbase recap](https://www.coinbase.com/developer-platform/discover/launches/agents-in-action-winners))
- **Consensus Miami EasyA (May 2026), Coinbase/AWS track, 1st place:** *Dairy Price API x402*, a pay-per-call commodity data and forecast API for agents. The winner was a **real vertical data product**, not infrastructure. ([CoinDesk](https://www.coindesk.com/tech/2026/05/08/ai-agents-fueled-a-frenzy-of-startup-building-at-the-consensus-miami-easya-hackathon))
- **Code NYC:** Toolkit.dev (monetized tool calls via x402), Secure Transport for x402, 1Shot Gas Station (gasless swaps with x402 auths). ([recap](https://www.coinbase.com/developer-platform/discover/launches/code-nyc-recap))
- **ETHGlobal HackMoney 2026, Arc track:** **Mand(ate)** (AI invoice escrow; agents negotiate terms, track milestones, auto-release), **Versus** (agents make video, viewers pay per second, revenue auto-splits), ArcFlow (treasury payroll). Judges looked at "technical execution, product utility, integration quality." Takeaway from a judge: *"They just want milestone payments without lawyers and wire delays."* 97% of submissions had agents, so **agents alone don't differentiate**. ([Arc blog](https://www.arc.io/blog/meet-the-arc-track-winners-from-the-hackmoney-2026-hackathon-and-what-we-learned))
- ETHGlobal Cannes and ETHOnline 2026 Hedera tracks explicitly reward **multi-agent negotiation + settlement via A2A/ACP + ERC-8004 identity**, the same theme as this track.

### ERC-8183 "Agentic Commerce" (job escrow standard), very relevant
- Draft ERC, Feb 2026, the formalization of Virtuals' ACP. Spec: https://ercs.ethereum.org/ERCS/erc-8183 · [Magicians thread](https://ethereum-magicians.org/t/erc-8183-agentic-commerce/27902) · [Dwellir explainer](https://www.dwellir.com/blog/erc-8183-agentic-commerce-explained)
- **Roles:** Client (funds), Provider (delivers), **Evaluator** (the only party who can `complete`/`reject` after submit; can be a contract).
- **States:** Open, Funded, Submitted, then Completed / Rejected / Expired. `claimRefund` after `expiredAt` is permissionless and never hookable.
- **Functions:** `createJob(provider, evaluator, expiredAt, description, hook)`, `setBudget`, `fund`, `submit(jobId, bytes32 deliverable, ...)`, `complete`, `reject`, `claimRefund`. Platform and evaluator fees are taken only on completion.
- **Hooks (`IACPHook`):** `beforeAction` / `afterAction` on each hookable call. This is the natural place to plug in **ERC-8004 reputation checks** and **HSP verification / compliance gates**.
- Virtuals ACP traction: about $400M+ cumulative agent-to-agent commerce (secondary source); the $95B figure is a broad company claim. Moved to Arbitrum and expanded to XRPL with an x402 facilitator. ([BlockEden](https://blockeden.xyz/pt/blog/2026/04/18/virtuals-protocol-arbitrum-agent-commerce-protocol-l2-choice/), [Delphi](https://members.delphidigital.io/reports/virtuals-acp-open-coordination-for-digital-labor))

### Key insight for HashKey
HashKey's differentiator is **compliance**: an SFC-licensed group, plus the KYC and sanctions attestations built into HSP. Every successful product on other chains (x402, ACP) is **pseudonymous**. A clear angle: *"the compliant version of the agent economy"*, where ERC-8183 job escrow is settled through HSP with KYC/sanctions capabilities enforced per job and identity via ERC-8004. That is "what worked elsewhere + HashKey customization", exactly what you asked for.

---

## Ranked shortlist (after iteration 2)

| # | Idea | Judge fit | Feasible in 7d | Demo | Why |
|---|---|---|---|---|---|
| 1 | **ERC-8183 job escrow on HashKey, HSP-native**: client agent posts a job, the provider agent delivers, an evaluator contract or agent attests, and release is paid out with an HSP Mandate/Receipt (compliant profile optional). An `IACPHook` gates on HSP KYC attestation + ERC-8004 reputation. | 10 | 8 | 9 | Ports the biggest A2A commerce standard and adds HashKey's compliance edge; it fills HSP's escrow gap |
| 2 | **Compliant x402 data/tool marketplace (MCPay-style)**: any MCP tool becomes pay-per-call via `x402Gate` + `@hsp/mcp`; a vertical demo (e.g. Indian market data or GST/invoice verification) | 8 | 9 | 8 | Mirrors the Dairy Price API win; uses the most official HSP path |
| 3 | **Agent milestone/invoice escrow for B2B** (Mand(ate)-style, Indian freelancer or exporter cross-border, ONERWAY off-ramp story) | 8 | 7 | 8 | Good story for Mumbai judges; overlaps with #1 |
| 4 | On-chain agent spend-policy wallet + SpendGuard | 6 | 8 | 6 | Feels like infrastructure; weaker demo |

Next: AP2 (mandates, how HSP extends it), ERC-8004 deployments, MPP/streaming and session payments, then Solana and Base agent hackathon winners.

---

## Iteration 3: AP2, ERC-8004, MPP/streaming, and **past HashKey hackathon winners**

### AP2 (Google, Sep 2025; HashKey joined Oct 2026)
- Every agent purchase is three signed mandates: **Intent Mandate** (user's scope and constraints), **Cart Mandate** (exact items and price the user approved), **Payment Mandate** (what gets charged). "Human-not-present" delegated purchases need a detailed Intent Mandate (price caps, timing). Crypto is supported through the **x402 extension**. 60+ partners, PayPal agent live. ([eco.com explainer](https://eco.com/support/en/articles/15192002-ap2-protocol-explained-google-s-agentic-commerce-standard-2026), [TechCrunch](https://techcrunch.com/2025/09/16/google-launches-new-protocol-for-agent-driven-purchases))
- **HSP's Mandate corresponds to AP2's Payment Mandate.** HSP does **not** expose Intent/Cart mandates. A project that adds an **Intent Mandate layer** (user-signed budget and scope that bounds what the agent may sign as HSP mandates, enforced on-chain) is a native, AP2-faithful extension judges will recognize.

### ERC-8004 (Trustless Agents): identity, reputation, validation
- Live since Jan 29, 2026 (co-authors include MetaMask, EF, Google, Coinbase). Three registries: Identity (ERC-721 agent ID + agent card URI), Reputation (feedback), Validation (re-execution, zkML, TEE proofs; mainnet pending). Deployed at the same CREATE2 address across chains (Identity `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`). 10k–100k+ registrations. ([QuickNode contracts](https://erc-8004.quicknode.com/docs/contracts), [growthepie](https://www.growthepie.com/quick-bites/eip-8004), [Taiko guide](https://taiko.xyz/guides/erc-8004-trustless-agent-standard))
- **Checked HashKey mainnet (chainId 177, `eth_getCode` via mainnet.hsk.xyz): there is NO code at the ERC-8004 Identity address.** It is not deployed on HashKey. **Bringing ERC-8004 to HashKey mainnet is an easy, credible "first" for the project.**

### MPP (Stripe + Tempo, Mar 2026): sessions and streaming
- HTTP-native. **Sessions**: an agent authorizes a spend limit upfront, then streams many micro-payments off-chain (vouchers) that are batched and settled. A streaming extension shipped Apr 2026. Partners include Visa, Lightspark, Anthropic and OpenAI. ([The Defiant](https://thedefiant.io/news/blockchains/tempo-launches-mainnet-unveils-machine-payments-protocol-with-stripe), [Fastly metered streams](https://www.fastly.com/blog/building-metered-streams-with-mpp-and-fastly-compute/))
- HSP has **no session or streaming primitive**. A "payment channel / voucher" adapter built with `@hsp/devkit` that settles a batch as one HSP-verified receipt is a strong technical differentiator, but it is the riskiest to build in 7 days.

### Past HashKey hackathon winners: what the judges have **already seen**
- **Horizon Hackathon (Mar–Apr 2026, DeFi | PayFi | AI):** PayFi 1st place **FlowLink** (AI payment agents for B2B invoicing and reconciliation), 2nd **hashpay** (payroll on HSP settlement), plus **HSP Payment Agent** (natural-language payments and RWA investing). ([DoraHacks report](https://dorahacks.io/hackathon/2045/report), [hashpay docs](https://www.hashpay.tech/docs))
- **Japan edition (Jun–Jul 2026):** AI track: Helm, Maneki AI (multi-agent perps, HSP USDC top-ups), MiuroAI. Also **SentryPay** (risk verdict engine that triggers autonomous HSP payouts, logged on-chain). ([X announcement](https://x.com/HSKChain/status/2077272198910529876), [Maneki](https://dorahacks.io/buidl/46960), [SentryPay](https://dorahacks.io/build/46973/milestones))
- Seoul 2025 PayFi: OSY (stable yield), Portal Trade.
- **Lesson:** natural-language payment bots, payroll, invoicing and single-agent auto-payout have **already won here**. Repeating them looks derivative. What's **missing** in HashKey's history is true **agent-to-agent** settlement: two autonomous agents transacting with escrow, verification, identity and reputation. That is literally the Track 2 name ("A2A Settlement").

---

## Ranked shortlist (after iteration 3)

| # | Idea | Judge fit | 7d | Demo | Notes |
|---|---|---|---|---|---|
| 1 | **"Compliant ACP for HashKey"**: ERC-8183 job escrow + ERC-8004 identity/reputation (first deployment on HashKey mainnet) + HSP settlement (release = HSP Mandate/Receipt, verified by `HSPVerifier`; compliant profile with KYC/sanctions enforced by an `IACPHook`) + `@hsp/mcp` so any Claude/LLM agent can hire or get hired | **10** | 8 | 9 | True A2A, nothing like it in past HashKey winners, uses every HSP layer |
| 2 | **AP2 Intent-Mandate wallet**: user signs a budget/scope intent; an on-chain policy contract enforces that every HSP mandate the agent signs fits it (caps, allowlist, expiry, category) | 8 | 8 | 7 | Can be a *module inside #1* (the client agent's spend policy) |
| 3 | **x402 pay-per-call marketplace for agent tools** (compliant x402) | 7 | 9 | 8 | Safe, but crowded and closer to past winners |
| 4 | HSP session/streaming adapter (MPP-style) | 8 | 5 | 8 | High risk; possible stretch goal |

Next: products with real traction on Solana/Base (Payman, Skyfire, Nevermined, Crossmint, Halliday, Catena), plus the Mumbai/India angle, then finalize.

---

## Iteration 4: products with traction, spend governance, mainnet facts, India angle

### Agent-payment products (what the market pays for)
- **Nevermined** (scoped delegations by amount, time and category; Visa Intelligent Commerce + x402 integration Apr 2026; about 1.38M tx per a rival's page), **Skyfire** (KYA identity + signed spend tokens; takes 2–3% of each transaction), **Payman** (approval thresholds), **Crossmint** (wallets + cards + compliance), **Circle wallets** (on-chain caps and allowlists), **Openfort** (sessions, multi-party approval, audit). ([spend-governance comparison](https://pinkwallet.com/agentic/learn/ai-agent-spend-governance-tools-compared/), [Nevermined blog](https://nevermined.ai/blog/best-platforms-ai-agent-settlement-infrastructure), [FluxA comparison](https://fluxapay.xyz/learning/ai-agent-wallet-2026-crossmint-vs-nevermined-vs-flux-a))
- **Gap the whole market shares:** every tool enforces *pre-set limits*; **none checks whether a specific purchase matches the user's intent** or verifies that the counterparty actually delivered. Escrow plus an evaluator closes the second gap, and an AP2-style Intent Mandate closes part of the first.
- **Solana Frontier (Jun 2026, 2,857 projects):** the only agent-payments-adjacent winner was **Flovia** (analytics for machine-paid APIs); no A2A escrow winner. ([Colosseum](https://blog.colosseum.com/announcing-the-winners-of-the-solana-frontier-hackathon/))

### HashKey mainnet facts (checked on-chain via `mainnet.hsk.xyz`, chainId **177**)
| Token | Address | Decimals | EIP-3009 (needed for x402) |
|---|---|---|---|
| USDT (5,164 holders) | `0xF1B50eD67A9e2CC94Ad3c477779E2d4cBfFf9029` | 6 | ❌ no |
| USDC.e (bridged) | `0x054ed45810DbBAb8B27668922D110669c9D88D0a` | 6 | ✅ yes |
- So: use **USDC.e** for anything that touches x402 / HSP `payX402`. USDT only works on the plain evm-transfer path. (Cross-check against the official HashKey token docs before using real funds.)
- ERC-8004 registries are **not deployed** on HashKey mainnet (checked in iteration 3).

### India / Mumbai angle (for the pitch)
- About $45B+ of stablecoin transfers in India in a year; freelancers and exporters are a major use; regulation is unsettled; HSP is partnered with **ONERWAY** for stablecoin-to-fiat off-ramps. ([The Ken](https://the-ken.com/kaching/inside-indias-stablecoin-blind-spot/), [Skydo](https://www.skydo.com/blog/stablecoins-and-cross-border-payments), [PR Newswire: ONERWAY](https://www.prnewswire.com/news-releases/hashkey-settlement-platform-hsp-and-onerway-announce-strategic-partnership-to-shape-the-future-of-on-chain-payments-and-support-cross-border-commerce-development-302868883.html))
- Pitch line: *"Indian agent and API builders selling to global agents get paid with escrow protection, KYC-verified counterparties and an auditable receipt, which is compliance a regulator can read."*

---

# FINAL SHORTLIST

| Rank | Idea | Judge fit | Feasible in 7d | Demo | Total |
|---|---|---|---|---|---|
| **1** | **Compliant Agent Commerce on HashKey** (ERC-8183 escrow + ERC-8004 identity/reputation + HSP settlement/compliance + MCP) | 10 | 8 | 9 | **27** |
| 2 | **AP2 Intent-Mandate wallet** (user-signed budget/scope enforced on-chain over every HSP mandate an agent signs) | 8 | 8 | 7 | 23 |
| 3 | **Compliant x402 tool marketplace** (MCPay-style pay-per-call for agent tools, HSP `x402Gate`, USDC.e) | 7 | 9 | 7 | 23 |
| – | HSP session/streaming adapter (MPP-style) | 8 | 5 | 8 | 21 (stretch only) |

## Recommended pick: #1, with #2 and #3 folded in as modules

**One line:** *"Virtuals ACP worked on Base. We rebuilt it for regulated finance on HashKey: agents hire agents, funds sit in escrow, release only on verified delivery, and every leg is an HSP-verifiable, KYC-attested receipt."*

**Why it wins:**
- It is literally the track name: A2A **settlement**, not just payment. Past HashKey winners (FlowLink, hashpay, HSP Payment Agent, SentryPay) were single-agent payment bots; none did agent-to-agent escrow.
- It ports a proven standard (ERC-8183 / ACP) and adds HashKey's real edge, compliance, which pseudonymous chains can't offer.
- It fills HSP's biggest gap (no escrow, refunds or conditional release) and uses **every** recommended layer: `@hsp/sdk`, `@hsp/mcp` + SpendGuard, `skills/hsp-pay`, x402, compliant profile, and optionally a `@hsp/devkit` adapter.
- It gives the project a mainnet "first": the ERC-8004 registries on HashKey.

**Architecture (MVP):**
1. **Contracts on HashKey mainnet (and testnet):** ERC-8004 Identity + Reputation (reference code); an `AgenticCommerce` escrow (ERC-8183, USDC.e); `HSPComplianceHook` (an `IACPHook` whose `beforeAction(fund/setProvider)` requires the provider's issuer-signed KYC/sanctions attestation and a minimum ERC-8004 reputation, and whose `afterAction(complete/reject)` writes reputation feedback).
2. **HSP legs:** the client funds the job through `hsp.pay({to: escrow})` with the compliant profile, and the paymentId (mandateHash) is stored on the job. The provider agent buys its sub-tools through x402 (`payX402`) during the job, which also shows the x402 path. Every leg is visible in the Coordinator Explorer.
3. **Agents:** a Client agent (posts the job, e.g. "translate this pitch deck to Hindi" or "produce a market-data report"), a Provider agent (does the work and submits a deliverable hash), and an **Evaluator agent** (LLM + deterministic checks that calls `complete`/`reject`). All of them use `@hsp/mcp` tools, guarded by SpendGuard.
4. **Optional module (idea #2):** a client-side **Intent Mandate** contract (budget, category, expiry) the escrow checks in `fund`.
5. **Stretch:** an `acp-escrow` HSP adapter (devkit) that turns `PaymentReleased` events into first-class HSP receipts, so escrow payouts themselves are HSP-verified.

**Demo script (3 minutes):** register two agents (ERC-8004 IDs shown on Blockscout), then the client agent posts a job, it is funded via a compliant HSP payment (Explorer shows ACCEPT and the KYC capability), the provider works and pays a sub-tool via x402, the evaluator approves, funds release and reputation goes up. Run 2: an unverified provider is blocked by the hook. Run 3: a bad deliverable is rejected and refunded.

**Day plan (to the Nov 1 deadline):**
- **Oct 25–26:** contracts (8004 + 8183 + hook) with Foundry tests; deploy to testnet; get the HSP sandbox, API key and repo from the organizers/Telegram.
- **Oct 27–28:** HSP integration (pay, compliant profile, verify), the three agents via `@hsp/mcp`.
- **Oct 29:** frontend (job board, agent profiles, Explorer links); **mainnet deploy**.
- **Oct 30:** intent-mandate module or the devkit adapter as a stretch; polish the failure cases.
- **Oct 31:** demo video, README, DoraHacks submission; register for Mumbai demo day.
- **Nov 1:** buffer. Submit before 21:30 IST.

**Risks:** the HSP SDK and sandbox aren't public yet ("shared a few days after deployment"), so ask in the HashKey Telegram today. The Coordinator may be testnet-only, so plan HSP legs on testnet and escrow/registries on both, and state that clearly in the submission. HSP is pre-1.0, so pin versions.

---
---

# ROUND 2: Complex / frontier ideas (user feedback: escrow, spend-wallet and pay-per-call are too basic and already built)

## What the frontier research says is UNBUILT
- **SoK: Blockchain A2A Payments (arXiv 2604.03733, 2026):** credit, **netting** and cross-chain settlement are "not discussed / not addressed". Other open problems: settlement is weakly coupled to delivery (providers can get paid for incorrect or missing delivery), no shared record linking intent, policy, settlement and outcome, multi-hop payment obligations, the privacy vs accountability trade-off, and sanctions/jurisdiction screening before intent forms. ([arXiv](https://arxiv.org/html/2604.03733))
- **Agent-to-Agent Finance (arXiv 2607.00245):** credit, netting, insurance: not discussed. Calls for "selective verifiability, not radical transparency". ([arXiv](https://arxiv.org/html/2607.00245v1))
- **Free-Riding the Agentic Web (arXiv 2605.30998, ATC '26):** six real attack classes on x402, including cross-resource substitution (38% of hosts exposed), duplicate-settlement races, `upto` overdraft (up to 97.8% leakage), denial of settlement, and hidden-compute pricing manipulation (35–3,213x). Future work: TEE-bound settlement, service bonds with slashing, reputation-tiered authorization. ([arXiv](https://arxiv.org/html/2605.30998))
- **TessPay (arXiv 2602.00213):** a verify-then-pay design (TLSNotary + TEE proof of task execution gates escrow). Paper only, no implementation. ([arXiv](https://arxiv.org/html/2602.00213))
- **x402 Batch Settlement (May 2026):** escrow + off-chain vouchers redeemed in batches. **Bilateral only** (one buyer to one seller). ([x402.org](https://x402.org/writing/x402-batch-settlement)) FluxA ODP is similar. ([FluxA](https://fluxapay.substack.com/p/open-deferred-payments-odp-fast-and))
- **Bank of Bots (Apr 2026):** first loan to an AI agent (Base, BOB Score from on-chain payment proofs). Agent credit is just starting. ([FF News](https://ffnews.com/news/bank-of-bots-emerges-from-stealth-to-launch-the-first-financial-infrastructure-built-for-ai-agents-and-issue-the-worlds-first-loan-to-an-ai-agent))
- **TradFi benchmark:** CLS multilateral FX netting gives about 99% average funding reduction; DTCC NSCC netting cuts payment value by 98–99% daily. ([Euromoney: CLS](https://www.euromoney.com/article/8u9mjf4y44kk44gco40kcg0ok/awards/foreign-exchange-awards/the-worlds-best-fx-post-trade-solution-2025-cls/), [DTCC](https://www.dtcc.com/ust1/faqs))
- **HK context:** first HKMA stablecoin issuer licences (Apr 2026); real-name KYC for every holder creates a privacy tension. ([WalletConnect APAC](https://walletconnect.com/blog/stablecoin-regulation-in-apac-2026-hong-kong-singapore-japan-and-australia))

## Round-2 ideas

### A. AgentCCP: multilateral netting clearing house for the agent economy (RECOMMENDED)
**Problem:** agent economies are dense webs of micro-obligations (A pays B for data, B pays C for inference, C pays A for search). Settling each one on-chain is costly, leaks strategy and exposes the x402 attack surface. x402 batch settlement only nets bilaterally. Nobody has built the CLS/DTCC equivalent for agents.

**Mechanism:**
1. **Members:** KYC'd agents (HSP compliant profile = CCP membership) post margin in USDC.e to a `ClearingHouse` contract on HashKey mainnet.
2. **Obligations:** each A2A payment is an EIP-712 deferred HSP-style mandate signed by the payer (no on-chain tx). The provider checks it instantly against the payer's live credit limit (margin x risk factor x reputation tier), so it can deliver immediately with no settlement race.
3. **Netting cycle** (e.g. every 5 min): the engine computes multilateral net positions and posts `(cycleId, merkleRoot(obligations), netPositions[])`. The contract checks that the net positions sum to zero.
4. **Optimistic verification:** during a challenge window, any member can submit a signed obligation plus a Merkle proof showing it was omitted or mis-netted. The cycle reverts and the operator bond is slashed. Rollup-style trust minimization.
5. **Settlement:** net debtors pay via HSP (one verified payment per debtor per cycle) and net creditors are paid out. For example, 5,000 gross payments become about 20 transfers.
6. **Per-obligation finality via a custom HSP adapter (`@hsp/devkit`):** a "netting adapter" issues an HSP Receipt for each gross obligation, proving it was included in a finalized, settled cycle. The merchant's `HSPVerifier` ACCEPTs each micro-payment even though only net amounts moved. This is a real protocol extension of HSP.
7. **Default waterfall:** defaulter's margin, then the default fund, then pro-rata mutualized loss. The defaulter's credit is frozen and its reputation slashed.
8. **Risk engine:** real-time exposure, behaviour-aware credit limits, and concentration limits against colluding agent clusters.

**Why judges care:** "Settlement" is the track name. It is the agent version of plumbing HashKey Group already understands (CLS, CCPs, HKMA). It has one killer metric (netting compression %) and a dramatic failure demo (an agent defaults live and the waterfall absorbs it).

### B. Proof-of-Delivery settlement (verify-then-pay; TessPay made real)
- Every paid call carries zkTLS/TLSNotary proof of the upstream response and/or a TEE attestation of which model ran and how many tokens it produced.
- A custom HSP capability `proves:delivery:v1` (devkit adapter): the mandate *requires* proof of delivery, and the verifier ACCEPTs only if the proof checks. Fixes x402 resource substitution and hidden-compute inflation.
- Risk: zkTLS/TEE tooling in 7 days is hard.

### C. Agent credit network (revenue-based financing for agents)
- HSP receipts are wash-trade-resistant credit data (verifiable and KYC-linked), while raw x402 counts are about 50% wash trades.
- Agents borrow against verified future revenue. A lockbox receiver contract splits each incoming HSP payment to the lender until repaid. Lenders deposit into an ERC-4626 vault, and an underwriting agent prices credit.
- Fits as the credit layer of A (intraday CCP credit extends to term credit).

### D. Private compliant A2A payments (selective disclosure)
- A ZK proof that the payer holds an issuer-signed KYC/sanctions attestation satisfies `attests:kyc` without revealing identity, plus stealth payee addresses and a regulator view key.
- Fits HK's real-name tension. Risk: circuit work; weaker visual demo.

## Round-2 scoring
| Idea | Novelty | Depth | Judge fit | 7-day feasibility | Demo | Total |
|---|---|---|---|---|---|---|
| **A. AgentCCP** | 9 | 9 | 10 | 7 | 9 | **44** |
| B. Proof-of-Delivery | 9 | 10 | 8 | 5 | 8 | 40 |
| C. Agent credit network | 8 | 8 | 8 | 7 | 7 | 38 |
| D. Private compliant payments | 8 | 9 | 8 | 5 | 6 | 36 |

**Recommended:** A as the core, with C as its credit layer; B and D go on the roadmap as pluggable HSP capabilities.

---
---

# ROUND 3: Complex ideas that can get users from day one (user feedback: AgentCCP is too niche and futuristic; where do users come from tomorrow?)

## Reality check on demand
- Real agentic demand is tiny. TRM Labs: $52.7M across 198.9M x402 settlements, and only **0.6–7.5% plausibly agentic**. Visa/Artemis: about 4,000 wallets do about 90% of real spend. ([Blockhead](https://www.blockhead.co/2026/10/15/ai-agents-have-made-138-million-payments-over-x402-most-of-them-under-10-cents/), [Startup Fortune](https://startupfortune.com/ai-agents-have-moved-over-200-million-payments-on-x402-but-half-may-be-fake/), [Chainalysis](https://www.chainalysis.com/blog/x402-agentic-payments-adoption/))
- Visa CEO (Sep 2026): "We are seeing adoption for shopping, but not yet for autonomous payments." OpenAI retired Instant Checkout in Mar 2026. ([paymentreview](https://paymentreview.com/blog/agentic-commerce-merchants-2026/), [elogic](https://elogic.co/blog/chatgpt-commerce-statistics/))
- **Rule for round 3:** start from humans who ALREADY pay money and have a trust problem. Agents and A2A settlement are how we solve it, not the pitch.

## Markets with existing users and pain
1. **Crypto signal groups (Telegram):** paid tiers about $8–80/month. Fraud is rampant: fake profit screenshots, "VIP signal" scams paid via UPI, Rs 6.5 lakh and Rs 42 lakh losses in Chandigarh and Bengaluru cases. **No one independently verifies signal performance.** ([CYFIRMA](https://www.cyfirma.com/?p=41248), [Quick Heal](https://www.quickheal.co.in/knowledge-centre/telegram-scam-in-india-and-how-to-stay-safe-online/), [Outlook Money](https://www.outlookmoney.com/news/crypto-fraud-bengaluru-man-scammed-of-over-rs-40-lakhs-via-telegram-group), [Tribune](https://www.tribuneindia.com/news/chandigarh/chandigarh-man-duped-of-over-rs-6-lakh-in-telegram-based-crypto-investment-fraud), [Plisio pricing](https://plisio.net/de/crypto/best-crypto-signals))
2. **OpenClaw / agent skill economy:** about 2M users at peak (unverified); 13.7k–37k skills; premium skills sell for $10–200; top authors earn $100–1,000/month; ClawHub takes a 15% fee. **Trust crisis:** 341 of 2,857 audited skills were malicious (Koi Security, Feb 2026); Unit 42 found malware past the scanners (Jun 2026). ([openclawdc](https://openclawdc.com/blog/openclaw-clawhub-guide/), [cybersecuritynews](https://cybersecuritynews.com/openclaw-skill-marketplace-exposes-ai-agents/), [crewclaw](https://crewclaw.com/blog/sell-openclaw-agents-marketplace), [Wikipedia](https://en.wikipedia.org/wiki/OpenClaw))
3. **Indian developers blocked from paying for AI APIs:** long-running "card declined" threads (RBI recurring e-mandate rules, Stripe card storage). ([OpenAI forum 1](https://community.openai.com/t/india-your-card-has-been-declined/90726), [OpenAI forum 2](https://community.openai.com/t/unable-to-make-payment-from-india/938806?page=5))
4. India's data-annotation workforce: $250M (2020-21), heading to $7B by 2030, paid a couple of dollars an hour. Demand side (AI labs) is hard to win in a hackathon, so this is deprioritized. ([The Wire](https://thewire.in/tech/indias-data-workers-the-human-labour-making-machines-learn), [WION](https://wionews.com/business-economy/for-rs-250-per-hour-how-indians-are-selling-their-future-to-american-ai-companies-1781541364347))

## Round-3 ideas

### R3-1. Nundina: signal marketplace where you pay only if the signal works (RECOMMENDED)
- **Users on day 1:** existing Telegram signal subscribers (who want a refund when wrong) and honest signal providers (an unfakeable track record is the best marketing they can get).
- **Flow:**
  1. A provider (human or AI signal agent) **commits** each signal on HashKey *before* the move (hash + timestamp). It is encrypted to paying subscribers and revealed publicly after the horizon, so there is no hindsight editing and no deleting losing calls.
  2. The subscriber's **execution agent** pays per signal through HSP into a **performance escrow**.
  3. At expiry, an **oracle (APRO / Supra, both on HashKey)** checks TP/SL/horizon. Hit pays the provider; miss refunds the subscriber (or a configurable split).
  4. The track record is computed from *all* commitments, which blocks the "post 10 contradictory signals" trick, and is shown as an on-chain leaderboard.
  5. Optional: the execution agent auto-trades on HSKSwap, which bridges to Track 1.
- **A2A layer:** aggregator agents buy signals from many providers, blend them and resell. Revenue flows **down the chain automatically** (multi-hop settlement, which the SoK lists as an open problem). Provider agents, execution agents and aggregator agents all settle through HSP.
- **Compliance edge:** providers carry HSP KYC attestations ("verified provider" badge). This is the anti-scam story Indian users and regulators want.
- **Acquisition:** a Telegram bot that drops into existing groups, so no app install. Pitch to providers: "prove you're not a scammer." Pitch to users: "refund if wrong."
- **Complexity:** commit-reveal with subscriber encryption, oracle-conditional settlement, anti-gaming scoring, multi-hop revenue routing, HSP per-signal payments, and an execution agent.
- **Risk:** must be framed as verifiable crypto analytics, not investment advice (crypto signals sit outside SEBI's securities finfluencer rules, but say so carefully).

### R3-2. SafeSkills: insured, pay-per-use skill/MCP marketplace for OpenClaw and Claude Code agents
- **Users on day 1:** skill creators who want monetization, and agent users scared of malware.
- **Flow:** buyer agents pay per invocation through HSP/x402. Sellers post a **bond**. **Auditor agents** stake on "safe" verdicts. A proven-malicious skill means the seller's and auditors' stakes are slashed to compensate victims (built-in insurance). A **royalty DAG** means that when skill A depends on skill B, every payment is auto-split down the dependency tree.
- **Acquisition:** ship as an OpenClaw skill and a Claude Code plugin; offer creators a lower fee than ClawHub's 15%.
- **Complexity:** bonding, slashing and claims, an auditor staking market, DAG royalty settlement, metering.

### R3-3. Stablecoin AI-API gateway for developers whose cards get declined
- **Users on day 1:** Indian students and developers with declined cards. They get an OpenAI-compatible endpoint that works with Cursor, Claude Code and OpenClaw tomorrow.
- **Flow:** a prepaid HSP session (deposit USDT/USDC.e once), per-request metering, **verified token accounting** (cross-checks the provider's usage, which counters the x402 hidden-compute inflation attack), auto-refund for failed calls, team budgets for coding agents.
- **Risks:** OpenRouter already accepts crypto; provider ToS on reselling. It has the most users but the least novelty.

## Round-3 scoring
| Idea | Users on day 1 | Novelty | Depth | Track 2 fit | Demo | Feasible in 8d | Total |
|---|---|---|---|---|---|---|---|
| **R3-1 Nundina** | 9 | 9 | 8 | 8 | 10 | 8 | **52** |
| R3-2 SafeSkills | 7 | 8 | 8 | 9 | 7 | 7 | 46 |
| R3-3 AI-API gateway | 9 | 5 | 6 | 7 | 6 | 9 | 42 |


---

# Round 4: Nundina, cold start and future-proofing (2026-10-24)

## Q1. Cold start: nobody pays before there is public validation

### How comparable products got their first users
| Product | What they gave away first | When money came in | Lesson for us |
|---|---|---|---|
| Numerai | Free predictions, scored publicly | Staking was optional and came after a scored history existed | Free scoring first, staking later |
| Bittensor SN8 (Taoshi PTN) | A 60-day challenge period before rewards | Only traders who pass the challenge get paid | Use a probation window: verified for N days, then paid |
| Collective2 | Public, go-forward-only track records with no backtests allowed | Subscriptions after the record exists. It charges providers a fee, which forum users criticise | Never charge providers for building a record |
| Fat Pig Signals (Telegram) | A free channel with about 60k members and a sample of signals. Its full record since 2018 is the trust asset | VIP channel with about 8k members (roughly 13%) | Free-to-VIP is the existing funnel, so plug into it rather than replace it |
| eToro Popular Investor | Free copying. Only about 0.1% of accounts become Popular Investors | Providers are paid up to 1.5%/yr of assets copied | Reputation leads to money for providers, and the subscriber pays nothing extra |
| Hyperliquid vaults | A public leaderboard computed from chain data | 10% performance fee on profit only | Performance-only fees are already accepted in crypto |
| Kaito Yaps | A free leaderboard drove explosive growth | It died when X banned pay-to-post in January 2026 | Don't depend on a single platform |
| Myfxbook (forex, from prior knowledge) | Free "verified track record" badges for providers | Monetised through brokers and ads, not providers | The closest analog. The badge becomes the industry standard and providers market it for you |

### The bootstrap design: free first, then pay-if-works
1. **Phase 0, the "shadow leaderboard" (day 1, no signups needed).** A read-only bot watches public signal channels and an LLM parses each call (pair, entry, TP, SL, time). Each call is scored against oracle and CEX price history, so the leaderboard exists before any provider joins. It is labelled "observed since <date>, not provider-committed". Channels with good scores get an invite to claim their profile, and channels with bad scores have a reason to want to fix theirs.
2. **Phase 1, free verification for providers.** A provider adds the bot to their channel. Every signal is committed on HashKey with a hash and timestamp, gas sponsored by us (HashKey gas is very cheap). They get a public profile link and a "Verified" badge to post in their own channel. Their existing free channel is our distribution.
3. **Phase 2, probation.** After 30 days or 50 signals with a positive score, a provider can turn on "pay-if-works" for their VIP tier, which is the Bittensor-style challenge.
4. **Phase 3, guaranteed signals.**
   - Subscriber agents pay per signal via HSP into escrow. A win goes to the provider and a loss is refunded.
   - Our take rate applies only to settled wins.
   - A subsidy pool (hackathon or ecosystem grant) covers the first N refunds so a first-time user risks nothing.
5. **Seed supply with our own agents.** Three open-source strategy agents (momentum, funding-rate, news-sentiment) publish signals from day one. The marketplace is never empty, and these agents run the A2A demo.
6. **Free content for subscribers.** Every signal is revealed publicly after it expires, which gives the public an endless feed of "graded calls" to share. Paying gets you the signal in real time instead of after the fact.

The key reframe: **the provider is the first customer, and they pay nothing.** Providers want proof because proof sells their VIP tier. Subscribers come through the providers' own channels.

## Q2. Future-proofing

1. **Make the signal a standard object.** Define the signal commit as an EIP-712 typed struct. Then any agent can consume it, verify it and pay for it:
   - Expose it as an MCP server (`get_signals`, `verify_track_record`, `subscribe`) and an A2A agent card.
   - Gate it behind HSP and x402, using USDC.e on HashKey, which supports EIP-3009.
2. **Make reputation portable through ERC-8004.** ERC-8004 is not deployed on HashKey (no code at `0x8004A169...`). We would deploy the Identity and Reputation registries there first and write each settled outcome as feedback with the HSP receipt attached, so a provider's record moves with them. This is the same flow Celo documents: discover, filter by reputation, pay, then give feedback.
3. **Let the buyers become agents.** Estimates put AI agents at about 30% of Polymarket wallet activity, and 5% of bot-like wallets drive 75% of volume. Long term, the buyer of alpha is a trading agent that needs to verify before it pays, which is what this product does.
4. **Generalize the resolver.** Oracle adapters can settle any verifiable claim: price targets, prediction-market outcomes, funding rates, sports. That turns "pay-if-right signals" into "pay-if-right predictions of anything".
5. **Moat.**
   - The dataset of committed, timestamped calls cannot be forged retroactively, so a competitor starting later cannot recreate the history.
   - The reputation score could become a credit score for agents, linking back to the agent credit idea from Round 2.
6. **Platform risk (the Kaito lesson).** Run the bot on Telegram, a web app and MCP together. The protocol lives on-chain, not inside Telegram.
7. **Regulation.** SEBI rules (2024) restrict dealings with unregistered finfluencers. Position the product as neutral verification infrastructure and analytics, not advice. Providers carry their own compliance, and HSP KYC attestations show who is verified.

### Sources
- Collective2: https://elitetrader.com/et/threads/how-does-collective2-work.229089/ , https://tearsheet.co/?p=4343
- Numerai: https://docs.numer.ai/ , https://medium.com/numerai/numerais-master-plan-1a00f133dba9 , https://forum.numer.ai/t/how-was-the-tournament-at-the-beginning-of-numerai/5658
- Taoshi PTN: https://www.prnewswire.com/br/comunicados-para-a-imprensa/os-principais-traders-participam-da-competicao-de-trading-descentralizado-da-taoshi-para-criar-via-crowdsourcing-estrategias-de-investimento-de-alto-desempenho-e-ganhar-uma-parte-do-pool-de-recompensas-de-mais-de-us-30-milhoes-302436734.html , https://www.bankless.com/de/bittensor-crypto-vaporware-tao.md
- Fat Pig free vs VIP: https://dailycoin.com/crypto-signals-telegram-top-channels/
- eToro: https://sacra.com/chat/h/d9dcbcc5-e54d-4699-b54a-c12461eb1977/ , https://help.etoro.com/articles/en_GB/Knowledge/what-is-etoro-s-popular-investor-program
- Hyperliquid vaults: https://tradingstrategy.ai/vaults/hyperdash-vault-1 , https://eco.com/support/en/articles/15197987-hyperliquid-vault-strategies-2026-hlp-and-user-vaults-explained
- Kaito shutdown: https://blockeden.xyz/blog/2026/04/18/kaito-yaps-attention-economy-infofi-meritocratic-influence/
- ERC-8004: https://docs.celo.org/build-on-celo/build-with-ai/8004 , https://docs.base.org/ai-agents/reference/contracts , https://www.alchemy.com/overviews/erc-8004
- Agents on Polymarket: https://blockeden.xyz/blog/2026/01/25/prediction-markets-polymarket-kalshi-ai-agents/ , https://simplefunctions.dev/opinions/prediction-markets-information-finance-q2-2026
