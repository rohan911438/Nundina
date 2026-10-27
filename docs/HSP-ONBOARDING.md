# HSP merchant gateway onboarding (testnet)

Source: HashKey Merchant API docs, https://hashkey-merchant.github.io/#/ (repo `hashkey-merchant/hashkey-merchant.github.io`, `docs/en/onboarding.md`).

| Step | Status |
|---|---|
| 1. secp256k1 (ES256K) merchant key pair | ✅ Generated 27 Oct 2026 with openssl. The private key is `secrets/hsp_merchant_private_key.pem`, which is gitignored and must never be committed or shared. The public key is below |
| 2. Send registration details to the organizers (DM Alex DD, @ohalex) | ⏳ You send it (draft below) |
| 3. Accept the invite email, verify it and bind the organization | ⏳ You (admin email) |
| 4. Create an app in the merchant console → `app_key`, `app_secret` → `.env` (`HSP_MERCHANT_APP_KEY`, `HSP_MERCHANT_APP_SECRET`) | ⏳ You |

QA (testnet) gateway: `https://merchant-qa.hashkeymerchant.com` (`HSP_MERCHANT_BASE_URL`).

## Merchant public key (safe to share)
```
-----BEGIN PUBLIC KEY-----
MFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEkQa5IsDv0Sli/7pUIkeVmTTw1GHNtMr4
3Dv5Osed2/u+bnaU3obuM+HsBmE0i/EfmRhcM+IqnIa7rnQU+hrA/g==
-----END PUBLIC KEY-----
```

## DM draft (to Alex DD, @ohalex)

> Hi Alex, we're building **Nundina** for Track 2 (Agent Payments & A2A Settlement): pay-if-right trading signals, where agents pay through HSP into an on-chain escrow on HashKey Chain. We'd like to use the real HSP gateway on testnet. Our merchant onboarding details:
>
> - **organization_name:** Nundina
> - **email:** `<admin email>`
> - **description:** Pay-if-right trading signals settled agent-to-agent on HashKey Chain (Track 2)
> - **default_language:** en
> - **service_rate:** 0.0000
> - **supported_chain_tokens:**
>   - hashkey-testnet (133) USDC `0x8FE3cB719Ee4410E236Cd6b72ab1fCDC06eF53c6` (EIP-3009)
>   - hashkey-testnet (133) USDT `0x372325443233fEbaC1F6998aC750276468c83CC6` (Permit2)
> - **public_key:**
> ```
> -----BEGIN PUBLIC KEY-----
> MFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEkQa5IsDv0Sli/7pUIkeVmTTw1GHNtMr4
> 3Dv5Osed2/u+bnaU3obuM+HsBmE0i/EfmRhcM+IqnIa7rnQU+hrA/g==
> -----END PUBLIC KEY-----
> ```
>
> Two quick questions:
> 1. Our payer is an agent, not a browser checkout. Could you share the **Payment Mandate schema and the `/api/v1/payment/pay-mandate` endpoint** (request fields, EIP-712 domain/types for USDC and USDT, and how the gateway reports the result)? The public docs only cover the Cart Mandate side.
> 2. Where can we get **HashKey testnet USDC/USDT** (the contracts above) for our test agent wallets?
>
> Thanks!

Fill in `<admin email>` before sending. It must be an inbox you can open, because the invite link goes there.
