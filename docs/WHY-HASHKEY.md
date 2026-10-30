# Why HashKey Chain

## Short answer

Nundina is a **trust product**. HashKey is the chain whose identity is trust and compliance, and its settlement protocol (HSP) has **KYC and sanctions attestations built in**. On a pseudonymous chain, a "verified provider" badge would be our own claim. On HashKey, it can come from the payment protocol itself.

## What Nundina uses from HashKey

| HashKey piece | How Nundina uses it | Status |
|---|---|---|
| **HSP Payment Mandates** | Every purchase is an EIP-712 mandate signed by the payer, followed by a non-custodial stablecoin transfer to the escrow, verified on-chain before credit | Live on testnet (direct rail) |
| **HSP merchant gateway** | One order per purchase, paid straight to the escrow; credit only after our own on-chain check of the transfer | Built and tested; switches on with merchant credentials |
| **x402 via HSP facilitator** | MCP data tools charge per call | Built; falls back to prepaid credits |
| **APRO oracle (push)** | BTC/USD and HSK/USD prices for settlement at expiry | Wired for mainnet, with Supra push as automatic fallback |
| **Supra oracle (push + pull)** | Fallback price source; signed pull proofs for TP/SL touches | Push wired; pull proofs enabled once the proof API is confirmed |
| **USDT and USDC.e** | Payment tokens (both 6 decimals) | HSP testnet tokens on testnet |
| **ERC-8004 registries** | Identity for every provider and agent; every settlement written as reputation feedback | **First deployment on HashKey Chain** (testnet) |
| **Near-free gas** | We sponsor every provider's commit through a relayer | Live |

## Verified on-chain (HashKey mainnet, chain 177)

| Item | Address | Note |
|---|---|---|
| APRO BTC/USD | `0x204ED500ab56A2E19B051561258E3A45c850360F` | 8 decimals, 0.5% deviation; reads are allowlisted |
| APRO HSK/USD | `0x86CE42c1b714149Dc3A7b17169EF67b5F78A224b` | 8 decimals |
| Supra pull contract | `0x16f70cAD28dd621b0072B5A8a8c392970E87C3dD` | BTC/USD pair 0 |
| Supra storage | `0x58e158c74DF7Ad6396C0dcbadc4878faC9e93d57` | Open push storage, used as fallback |
| USDT | `0xF1B50eD67A9e2CC94Ad3c477779E2d4cBfFf9029` | 6 decimals |
| USDC.e | `0x054ed45810DbBAb8B27668922D110669c9D88D0a` | 6 decimals, supports EIP-3009 |
| ERC-8004 canonical address | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | **No code on chain 177**, so ERC-8004 is not yet on HashKey |

**Gas.** At 500 gwei, a signal commit (~100k gas) costs about 0.05 HSK, roughly **$0.004**. Ten thousand sponsored commits cost about $44.

**Oracle design.** APRO push feeds update on a 0.5% move or a long heartbeat, which is too coarse to detect intrabar touches. So settlement at expiry uses push prices, while TP/SL touches are proven with timestamped pull proofs submitted by a permissionless keeper, under a 10-minute challenge window. APRO reads are access-controlled, so the resolver reads through `FallbackPriceAdapter(APRO → Supra push)` and works before APRO allowlists us. Details: [`contracts/ORACLES.md`](../contracts/ORACLES.md).

## Ecosystem fit

- **Track 2** asks for agent payments and A2A settlement. Nundina's core is outcome-conditional, multi-hop settlement between agents.
- **Past HashKey projects** covered invoicing, payroll, natural-language payments and payouts. None did outcome-conditional A2A settlement.
- **The Mumbai edition** pairs naturally with India's large Telegram trading community and its scam problem.
- **Atlas Grant Program:** HashKey's grant pool focuses on PayFi and stablecoins, a funding path after the hackathon.
