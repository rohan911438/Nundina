import { BadgeCheck, CreditCard, Lock, Scale } from "lucide-react";
import { SectionHead } from "./SectionHead";

const STEPS = [
  {
    Icon: Lock,
    title: "Lock",
    body: "The provider posts in Telegram as usual. Nundina commits the signal on HashKey Chain before the price moves: timestamped, encrypted, impossible to edit or delete.",
  },
  {
    Icon: CreditCard,
    title: "Pay",
    body: "You, or your AI agent, pay per signal through HSP. The money sits in an on-chain escrow and the decryption key arrives right away.",
  },
  {
    Icon: Scale,
    title: "Settle",
    body: "APRO and Supra oracles decide the result. Right: the provider is paid. Wrong: you're refunded automatically, plus a slice of their bond.",
  },
  {
    Icon: BadgeCheck,
    title: "Prove",
    body: "Every call is revealed and scored, then written to ERC-8004 reputation: a public track record no one can fake or take with them selectively.",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
      <SectionHead eyebrow="How it works" title="Four steps, all on-chain" />
      <ol className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s, i) => (
          <li key={s.title} className="relative bg-surface p-6">
            <div className="flex items-center justify-between">
              <s.Icon aria-hidden className="size-5 text-accent" />
              <span className="num text-xs text-muted">0{i + 1}</span>
            </div>
            <h3 className="mt-8 text-lg font-semibold">{s.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
