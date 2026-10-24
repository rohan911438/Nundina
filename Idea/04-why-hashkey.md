# 4. Why HashKey Chain

## 4.1 Short answer
Nundina is a **trust product**. HashKey is the chain whose identity is trust and compliance (an SFC-licensed group), and whose settlement protocol (HSP) has **KYC and sanctions attestations built in**. On a pseudonymous chain the "verified provider" badge would be our own claim. On HashKey it is the payment protocol's own attestation.

## 4.2 What we use from HashKey, and why
| HashKey piece | How we use it | Why it matters |
|---|---|---|
| **HSP (HashKey Settlement Protocol)** | Every signal purchase is an HSP Mandate (EIP-712, signed by the payer) → a non-custodial ERC-20 transfer to escrow → an HSP Receipt verified with `HSPVerifier`. Escrow credits a payment only after verification. | Required by the hackathon. Zero custody, verifiable, and agent-friendly |
| **HSP compliant profile** (`attests:kyc`, sanctions) | Providers with a KYC attestation get a "Verified Provider" badge. Large pay-if-works tiers can require KYC'd providers. | The anti-scam story, built into the protocol |
| **`@hsp/mcp` + SpendGuard** | Execution agents buy signals under per-transaction caps, daily caps and allowlists | Safe autonomous spending |
| **`@hsp/sdk`: `payX402` / `x402Gate`** | Our MCP and HTTP signal API charges per call | Agent-native pay-per-call |
| **`@hsp/devkit`** (stretch) | A custom "conditional-release" settlement adapter, conformance-tested | Shows deep protocol integration and earns judge points |
| **APRO oracle (push)**, live on mainnet | BTC/USD and HSK/USD price feeds for settlement | Native oracle; no need to bring our own |
| **Supra oracle (pull)**, live on mainnet | Signed price proofs at the moment TP or SL is touched (other pairs, finer timing) | Precise touch detection |
| **USDC.e** (supports EIP-3009) | Gasless "fast path" payment straight into escrow (`receiveWithAuthorization`) | Works with x402 |
| **USDT** | Plain HSP evm-transfer path | The stablecoin with the most holders on HashKey |
| **HSKSwap** | Execution agents can auto-trade the signal (also earns Track 1 credit) | Closes the loop from signal to trade |
| **HashKey AgentKit** (`HashkeyHSK/agentkit`) | Wallets for execution and strategy agents | Officially recommended tooling, which earns extra points |
| **ERC-8004 registries: not yet on HashKey** | We deploy Identity and Reputation registries to HashKey mainnet and write every settlement as feedback | A credible ecosystem "first" |

## 4.3 Verified on-chain (HashKey mainnet, chainId 177, RPC `https://mainnet.hsk.xyz`, read Oct 23–24 2026)
| Item | Address | Live reading |
|---|---|---|
| APRO BTC/USD (8 decimals, 0.5% deviation, 1h heartbeat) | `0x204ED500ab56A2E19B051561258E3A45c850360F` | **$81,661.26** at 2026-10-23 16:48 UTC ✅ |
| APRO HSK/USD (8 decimals) | `0x86CE42c1b714149Dc3A7b17169EF67b5F78A224b` | **$0.0873** at 2026-10-23 18:51 UTC ✅ |
| APRO USDT/USD | `0x823d7f90f7A3498DB6595886b6B5dC95E6B0B7f3` | (from docs) |
| APRO USDC/USD | `0x244Ce344df8837c9d938867E2Ffbf0E4B0169B56` | (from docs) |
| Supra Pull contract | `0x16f70cAD28dd621b0072B5A8a8c392970E87C3dD` | (from docs; BTC/USD pair id 0) |
| Supra Storage contract | `0x58e158c74DF7Ad6396C0dcbadc4878faC9e93d57` | (from docs) |
| Chainlink Data Streams Verifier Proxy | `0x3278e7a582B94d82487d4B99b31A511CbAe2Cd54` | (from docs) |
| USDT | `0xF1B50eD67A9e2CC94Ad3c477779E2d4cBfFf9029` | 6 decimals, no EIP-3009 |
| USDC.e | `0x054ed45810DbBAb8B27668922D110669c9D88D0a` | 6 decimals, supports EIP-3009 |
| ERC-8004 Identity (canonical CREATE2 address) | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | **No code**, so not deployed |

**Gas cost:** the gas price was 500 gwei, paid in HSK. A signal commit at about 100k gas costs 0.05 HSK, roughly **$0.004**. Sponsoring every provider's commits is effectively free. Even 10,000 signals cost about $44.

**Oracle caveat:**
- The APRO push feeds update only on a 0.5% move or every hour, which is too coarse to detect intrabar TP/SL touches.
- **Design response:** settlement at expiry uses the APRO push price. TP/SL touches are proven with **Supra pull proofs**, submitted by a permissionless keeper with a challenge window (see `05-architecture.md`).
- **To confirm:** which Supra pair IDs are available on HashKey beyond BTC/USD.

## 4.4 Ecosystem fit
- **Atlas Grant Program:** HashKey's $50M HSK grant pool focuses on PayFi and stablecoins, which is a post-hackathon funding path.
- **Past HashKey winners** (FlowLink, hashpay, HSP Payment Agent, SentryPay, Maneki AI) covered invoicing, payroll, natural-language payments and auto-payouts. **None did outcome-conditional A2A settlement.**
- **The Mumbai edition** pairs naturally with an India-scale scam problem and a large Indian crypto-trading user base.
