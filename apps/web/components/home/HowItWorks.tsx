import { BadgeCheck, CreditCard, Lock, Scale } from "lucide-react";
import type { CSSProperties } from "react";
import { Reveal } from "@/components/motion/Reveal";
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
    <Reveal as="section" id="how" className="group mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
      <SectionHead eyebrow="How it works" title="Four steps, all on-chain" />
      <ol className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s, i) => (
          <li key={s.title} className="reveal-child relative overflow-hidden bg-surface p-6" style={{ "--i": i } as CSSProperties}>
            {/* progress rail: fills step by step once the section is in view */}
            <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 origin-left scale-x-0 bg-accent transition-transform duration-700 ease-out group-data-[reveal=in]:scale-x-100" style={{ transitionDelay: `${300 + i * 260}ms` }} />
            <div className="flex items-center justify-between">
              <span className="grid size-9 place-items-center rounded-xl border border-accent/25 bg-accent/10 transition-transform duration-500 group-data-[reveal=in]:scale-100 scale-75" style={{ transitionDelay: `${300 + i * 260}ms` }}>
                <s.Icon aria-hidden className="size-4.5 text-accent" />
              </span>
              <span className="num text-xs text-muted">0{i + 1}</span>
            </div>
            <h3 className="mt-8 text-lg font-semibold">{s.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
          </li>
        ))}
      </ol>
    </Reveal>
  );
}
