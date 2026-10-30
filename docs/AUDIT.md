# Contract audit (internal), 28 Oct 2026

Scope: `contracts/src` (PerformanceEscrow, ProviderRegistry, SignalBook, OutcomeResolver, RevenueRouter, SignerCreditVerifier, ERC-8004 registries, oracle adapters), plus the API and keeper code paths that move money through them. This is an internal review by the team, not a third-party audit.

## Method

| Step | Result |
|---|---|
| `forge test` (unit, fuzz, invariant suites) | 114 / 114 pass |
| `forge coverage --ir-minimum --skip script` | 96.9 % lines, 96.9 % statements, 84.3 % branches, 96.1 % functions |
| Slither 0.11.6 (`--exclude-informational --exclude-optimization`, mocks/tests/scripts filtered) | 0 high, 22 medium, 32 low. All triaged below |
| Manual review of every external function that moves funds or changes an outcome | 2 fixes, notes below |
| Testnet (chain 133) role and wiring check, `pnpm contracts:check-roles` | all checks pass |
| Testnet token check | HSP USDT `0x3723…3CC6` and USDC `0x8FE3…53c6` are both 6 decimals, matching the escrow's assumption |
| Real-transaction lifecycle on testnet (`apps/api/scripts/testnet-lifecycle.ts`) | commit → reveal → proven TP → finalize → settle, and resolve-at-expiry → finalize → settle: pass. See "Live checks" |

## Findings

| # | Severity | Where | Finding | Status |
|---|---|---|---|---|
| 1 | Medium | `PerformanceEscrow.claimRefund` | Anyone could refund every buyer 24 h after expiry **even if the oracle had already finalized a WIN**. If the keeper was down for a day, a right provider lost its payout. | **Fixed**: refused with `OutcomeFinal` when the resolver reports a final outcome, so `settle` applies it. The resolver call is in `try`, so a broken resolver can never block refunds. Tests: `test_claimRefund_finalWin_mustSettle`, `test_claimRefund_pendingNotFinal_stillRefunds`. Live on testnet since the 28 Oct redeploy |
| 2 | Medium (API) | `POST /purchases` | A signal's pot holds one token, fixed by the first credit. A second buyer choosing the other token paid, then failed to credit (`WrongToken`) and had to wait for recovery. | **Fixed**: the API refuses with `409 token_locked` (and the token to use) before any money moves, using the on-chain pot or any in-flight purchase. The web Buy flow switches the token automatically. Test: `purchases.test.ts` |
| 3 | Low | `AproPushAdapter.priceAt` | If reading the next round reverts (for example at a phase boundary), the check that the hinted round is the latest one before `ts` is skipped, so a caller could choose an older round within `maxStaleness`. | Accepted: bounded by `maxStaleness`; on HashKey the keeper resolves promptly or uses a Supra proof. Revisit with the real APRO feed |
| 4 | Low | Escrow and registry | Bond slashes are in bond-token units equal to the price, so the bond token and payment token must both be 6-decimal stablecoins. | Holds for every allowlisted token (checked on testnet). Keep it as an allowlist rule |
| 5 | Info | `claimRefund` | A WIN can still be refunded if the outcome never finalizes within 24 h (oracle outage). | By design: funds must never get stuck |

## Slither triage

- **reentrancy-no-eth / reentrancy-benign** (escrow `_credit`, `settle`, `_refundAll`; resolver `proveTouch`): every external call goes to a protocol contract held in an `immutable` (registry, router, resolver, book, reputation) or a fixed token, and every external entry point is `nonReentrant`. False positive.
- **uninitialized-local**: Solidity zero-initialises locals; these are counters and sums. False positive.
- **unused-return**: tuple fields deliberately ignored (`outcomeOf` r-multiple, `tryRecover` error-arg, `latestRoundData` round ids). Prices are still checked for `> 0` and staleness. No issue.
- **incorrect-equality** (`isRevealed` enum compare): comparing an enum is intended.
- **timestamp**: deadlines and windows are minutes to hours long; miner skew of seconds doesn't matter.
- **calls-loop**: `RevenueRouter` legs are bounded (≤ 156 by `MAX_UPSTREAM = 5`, depth 3) and fit `MAX_LEGS = 160`; settlement payouts are pull-based, so no transfer can block it.
- **missing-zero-check**: constructor and wiring addresses are set by the deploy script and verified by `check-roles`.

## Properties reviewed and holding

- Credits never exceed real tokens: `balanceOf >= liabilities + amount` before every credit; withdrawals and recoveries reduce liabilities first.
- Single use of every HSP receipt, transfer tx and EIP-3009 nonce (the nonce is bound to `(signalId, payer)`).
- No credit after expiry, after a touch is pending, or past the subscriber cap; each credit locks `price` of provider bond.
- Late buyers can't farm the bond: the slash slice is only for buyers who paid before the oracle's decision time.
- Settlement, refunds and withdrawals are never pausable. Pausing only stops new credits.
- Bond withdrawals wait 7 days and re-check that the bond is unlocked at withdrawal time.
- The admin of every contract is the 1-hour timelock (checked on testnet).

## Live checks (testnet)

Run on 28 Oct 2026 with `apps/api/scripts/testnet-lifecycle.ts` against the deployment in `contracts/DEPLOYMENTS.md`. No payment tokens are needed: these are practice (free) signals, so the escrow pots are empty and settlement exercises the outcome, reputation and bond-unlock paths.

| Step | Signer | Tx | Gas |
|---|---|---|---|
| Signal #1 (expired): `resolveAtExpiry` from the push oracle | keeper | [0x0b1e9a63…](https://testnet-explorer.hsk.xyz/tx/0x0b1e9a63b40fb0f71198ad79f0832e49d154d19d8fff26d00d94f7b75910eb1f) | 110,921 |
| Signal #3: `commit` (provider signs EIP-712, relayer sends) | relayer | [0xb47c587e…](https://testnet-explorer.hsk.xyz/tx/0xb47c587ea27d54fb6778d83814305d80d0a1944f8fda28ec085923864b1e824e) | 224,678 |
| Signal #3: `reveal` | relayer | [0x76f3e84a…](https://testnet-explorer.hsk.xyz/tx/0x76f3e84a39c841e6fcc652cb94a331e143df102ec2c214736d56df245a018f76) | 229,017 |
| Oracle posts a TP touch | keeper | [0xc1be9a4a…](https://testnet-explorer.hsk.xyz/tx/0xc1be9a4a08d9b52fa67b396a13e1ba68901c95fbe9c9f6ccb699709c431b087c) | 47,240 |
| Signal #3: `proveTouch` (TP) | keeper | [0x1f0f7cf9…](https://testnet-explorer.hsk.xyz/tx/0x1f0f7cf9f6cf1e99232fe35315218ed65fcd1d0667409ebc0ec755ccb8df15aa) | 150,363 |
| Signal #1: `finalize` after the 10-min window | keeper | [0x3be992b4…](https://testnet-explorer.hsk.xyz/tx/0x3be992b4d50f350e205a6473c06219960d2ffbf25bd3c000ad388f5057d960bd) | 52,748 |
| Signal #1: `settle` | keeper | [0x6733ed18…](https://testnet-explorer.hsk.xyz/tx/0x6733ed1842613014cabb99fac83fbfe612233244b2123f29b8d5b031b772ec28) | 244,805 |
| Signal #3: `finalize` | keeper | [0xc88acd45…](https://testnet-explorer.hsk.xyz/tx/0xc88acd45c348bbef1459bb5ab95f02e491d69b90b95285abe2eec4ede62edf08) | 52,748 |
| Signal #3: `settle` | keeper | [0xf24b3bf9…](https://testnet-explorer.hsk.xyz/tx/0xf24b3bf9b699ae7fe105b3d0063fe3757e5f0c4ccfa7630c86f64bfe26ad54bb) | 175,182 |

End state: #1 LOSS, final, pot SETTLED; #3 WIN, final, pot SETTLED.

### Rerun on the redeployment (28 Oct 2026, with the `claimRefund` fix)

The contracts were redeployed with the `claimRefund` fix (`contracts/DEPLOYMENTS.md`, start block 34990052) and `CHAIN_ID=133 pnpm contracts:check-roles` passes. On a fresh deploy the script now registers the provider itself. The run above used the superseded first deployment.

| Step | Signer | Tx | Gas |
|---|---|---|---|
| `ERC-8004 identity register` (fresh deploy) | provider | [0x365822d2…](https://testnet-explorer.hsk.xyz/tx/0x365822d215687d74ac711568340bc78f2698dce9298b5dbdfb3556e75337d2d0) | 145,519 |
| `ProviderRegistry.register` (practice) | provider | [0x4510985f…](https://testnet-explorer.hsk.xyz/tx/0x4510985f1939b91f94156e2126448dba50fb5a52a7044df47d0948a8baa382af) | 165,059 |
| Signal #1: `commit` (provider signs EIP-712, relayer sends) | relayer | [0xddd8f407…](https://testnet-explorer.hsk.xyz/tx/0xddd8f40752e4b9a4f664d272a7bf773f6e432e179c032874bb436e1da0c5441f) | 241,777 |
| Signal #1: `reveal` | relayer | [0x8854c416…](https://testnet-explorer.hsk.xyz/tx/0x8854c4165f0ee853246a4443147edab524d6e07f100c5873c1d7c3084a01860b) | 229,017 |
| Oracle posts a TP touch | keeper | [0xecc99d35…](https://testnet-explorer.hsk.xyz/tx/0xecc99d35c808b51b837da8971217c6710aa07b89d1e8bca0c787b05d41805bb2) | 47,240 |
| Signal #1: `proveTouch` (TP) | keeper | [0x91278f88…](https://testnet-explorer.hsk.xyz/tx/0x91278f88201f2da79fb34d6a282d01f79c17974f96c96ce1884e6079359223e3) | 150,363 |
| Signal #1: `finalize` after the 10-min window | keeper | [0x316b55cf…](https://testnet-explorer.hsk.xyz/tx/0x316b55cf2aa5b9746ad757bcb998be9f8bd56faf63ac5b7090ceeca1b6cf4b63) | 52,748 |
| Signal #1: `settle` | keeper | [0x0c1fe306…](https://testnet-explorer.hsk.xyz/tx/0x0c1fe30689f560d9a12b3bbbaebbd03823f43c40b8a4f4b5cbeccaf8bf8fdfc1) | 257,031 |

End state: #1 WIN, final, pot SETTLED. The only failure was a read right after `settle` (`block not found` from a lagging node); the script now retries state reads too.

What broke on the way, and the fixes:

- **Commits revert with `StalePrice` when nobody pushes prices.** The testnet feed is a push oracle with a 2 h staleness limit, so the keeper must be running on testnet. The API now names this error in plain words instead of returning a raw selector (`apps/api/src/chain/relayer.ts`, `humanRevert`).
- **The public RPC is load-balanced and nodes lag by a block.** Seen as a stale simulation, `eth_getLogs` past the head, a stale pending nonce (`replacement transaction underpriced`) and stale reads right after a receipt. The script retries simulations, uses a local nonce manager, reads ids from the receipt and reads state at the receipt block. The keeper and API should use a dedicated or single-node RPC in production (`HSK_RPC_URL`).
- **The relayer refused every relay on testnet**: `RELAYER_MIN_BALANCE_WEI` defaulted to 0.05 HSK and the relayer holds about 0.02. A commit costs about 0.000225 HSK at 1 gwei, so the default is now 0.005 HSK (about 20 relays).
- One orphaned commit (signal #2, never revealed) is left from a run that crashed after committing. It expires harmlessly; as a practice signal nobody can buy it.

## Open items

- ~~Redeploy testnet~~ done 28 Oct (see the rerun above).
- **Paid flows on testnet** (bond deposit, HSP purchase, credit, WIN payout, LOSS refund and slash) need HSP's test USDT/USDC. The same flows run end to end on anvil in CI (`apps/api/test/purchases.test.ts`, `hspGateway.test.ts`, `apps/keeper/test`).
