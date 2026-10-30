# Oracles: what is confirmed and what is assumed

Checked against HashKey mainnet (chain 177) on 2026-10-26 with `cast` and Foundry fork tests (`test/OutcomeResolver.t.sol: AproForkTest`).

## APRO push feeds (BTC/USD `0x204E…360F`, HSK/USD `0x86CE…224b`)
| Fact | Status |
|---|---|
| Chainlink-style `latestRoundData`, 8 decimals, description `BTC/USD` | ✅ confirmed |
| **Reads are access-controlled.** The proxy calls `hasAccess(caller, selector)` on `0xB012…B143`; any contract not on the allowlist gets `No access`. Off-chain `eth_call` from an EOA works. | ✅ confirmed (fork test) |
| Heartbeat is **~24 h** in practice (rounds 15998→15999→16000 were 13.8 h and 24 h apart), with a 0.5% deviation trigger. The docs' "1 h heartbeat" is not what we observe. | ✅ observed |
| The proxy's `getRoundData` only answers for the latest round; the underlying aggregator (`aggregator()` = `0xb83d…DA71`) holds history but is access-controlled too. **No on-chain history.** | ✅ confirmed |

**Consequences in code**
- `AproPushAdapter.maxStaleness` is per feed and set to **26 h** at deploy (not 2 h).
- `priceAt(ts)` uses the latest round when it was published at or before `ts`; otherwise it tries the hint and reverts `NoHistory`.
- `FallbackPriceAdapter(APRO → Supra push)` is the resolver's push adapter, so the protocol works before APRO allowlists our adapter. **Action:** ask APRO to allowlist the deployed `AproPushAdapter` address.

## Supra push storage (`0x58e1…9d57`, SupraSValueFeed)
| Fact | Status |
|---|---|
| `getSvalue(pair) → (round, decimals, time[ms], price)`; BTC = pair 0, 18 decimals | ✅ confirmed |
| Readable by any contract (no allowlist) | ✅ confirmed (fork test) |
| Update cadence about hourly | observed once (value ~1 h old) |
| HSK/USD pair index | ❓ unknown, `SUPRA` market for HSK left unset |

## Supra pull oracle (`0x16f7…C3dD`, ERC1967 proxy → `SupraOraclePull` `0x76f9…c683`, verified on Blockscout)
| Fact | Status |
|---|---|
| `verifyOracleProofV2(bytes) → PriceInfo{pairs[], prices[], timestamp[], decimal[], round[]}` | ✅ confirmed from verified ABI |
| Timestamps in milliseconds (`MILLISECOND_CONVERSION_FACTOR = 1000`), `TIME_DELTA_ALLOWANCE = 3000` | ✅ confirmed |
| Garbage proof bytes revert | ✅ confirmed (fork test) |
| Proof bytes come from Supra's REST/gRPC "pull" service (`SUPRA_PROOF_API_URL`) | ❓ assumed: endpoint + format must be confirmed; keeper has a mock path |
| A real proof verifies through `SupraPullAdapter.verifyTouch` end-to-end | ❓ not yet tested (needs a proof from the service) |

**Feature flag.** `OutcomeResolver.touchProofsEnabled` starts **false** on mainnet. With it off every signal resolves at expiry via the push adapter (the agreed cut rule), and `proveTouch` reverts. With it on:
- TP/SL/ENTRY touches are proven with Supra pull proofs, earliest touch wins after a 10-minute challenge window.
- An expiry mark-to-market is also held for 10 minutes so an earlier touch proof can override it.
- `resolveAtExpiryWithProof` prices the expiry from a Supra proof timestamped in `[validUntil, validUntil + 5 min]`, for when the push feed has already moved on.

## Coarse-oracle caveats (stated openly)
- With touch proofs off, a signal whose SL was hit intrabar and then recovered can still be scored a WIN at expiry. Enabling Supra touch proofs closes this.
- Entry checks use the push price at commit, which can lag by up to the 0.5% deviation. So the limit threshold is **1%** (`SignalBook.limitThresholdBps = 100`), and any signal whose TP/SL do not bracket that price is also treated as a limit signal (stops "already touched" wins).
