import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Legal",
  description: "Nundina is verification infrastructure, not investment advice.",
};

const SECTIONS: { h: string; p: string[] }[] = [
  {
    h: "What Nundina is",
    p: [
      "Nundina is verification and settlement infrastructure. It records trading signals on HashKey Chain before the market moves, holds payments for them in an on-chain escrow, and settles each signal from public oracle prices.",
      "Nundina does not give investment advice, does not recommend any signal or provider, and does not manage anyone's money. Scores and rankings describe what happened in the past; they do not predict what will happen next.",
    ],
  },
  {
    h: "Providers are responsible for their own signals",
    p: [
      "Signals are the opinions of the providers who post them. Providers are responsible for complying with the laws that apply to them, including any rules on investment advice, licensing and marketing in their country and in the countries of their subscribers.",
      "A Verified badge means the provider holds a valid KYC attestation from HSP. It is not an endorsement and says nothing about the quality of their signals.",
    ],
  },
  {
    h: "Risks",
    p: [
      "Trading crypto assets is risky. Prices can move fast and you can lose more than you expect, including the full amount you trade. Only trade with money you can afford to lose.",
      "The refund covers the price you paid for a losing signal. It does not cover losses from trades you place based on any signal.",
      "Smart contracts, oracles, payment rails and wallets can fail or be attacked. Oracle prices can differ from the price on your exchange. Settlement can be delayed by the challenge window, network congestion or an oracle outage; if no price is available, the escrow refunds everyone after 24 hours.",
      "Payments are in stablecoins (USDT, USDC.e). Stablecoins can lose their peg.",
    ],
  },
  {
    h: "Your data",
    p: [
      "Everything recorded on-chain is public and permanent: commitments, reveals, payments, results and reputation. Signal plaintext is encrypted until it is revealed; your decryption keys are wrapped for your wallet only.",
      "We store your wallet address, Telegram id if you link it, and your purchases so we can deliver keys and notifications.",
    ],
  },
  {
    h: "No warranty",
    p: [
      "Nundina is provided as is, without warranties of any kind. To the extent the law allows, we are not liable for trading losses or for losses caused by third-party systems, including blockchains, oracles, HSP and wallets.",
    ],
  },
];

export default function LegalPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 pb-10 pt-12 sm:px-6 sm:pt-16">
      <p className="text-xs font-medium uppercase tracking-wider text-accent">Terms &amp; disclaimer</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Verification infrastructure, not investment advice</h1>
      <p className="mt-4 text-sm text-muted">Last updated 26 October 2026</p>
      <div className="mt-12 space-y-10">
        {SECTIONS.map((s) => (
          <section key={s.h}>
            <h2 className="text-lg font-semibold">{s.h}</h2>
            <div className="mt-3 space-y-3 leading-relaxed text-muted">
              {s.p.map((t) => (
                <p key={t.slice(0, 32)}>{t}</p>
              ))}
            </div>
          </section>
        ))}
      </div>
    </article>
  );
}
