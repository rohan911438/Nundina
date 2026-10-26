import { BarChart3, Coins, Lock, Receipt, ShieldCheck, Undo2, Users } from "lucide-react";
import { SectionHead } from "./SectionHead";

/** The 7 trust rules (README, Idea/01 §1.5). */
export const TRUST_RULES = [
  { Icon: Undo2, title: "Refund if wrong", body: "Payment sits in escrow and comes back automatically when the call fails." },
  {
    Icon: Lock,
    title: "Every call counts",
    body: "Each signal is committed before the move, with no edits or deletes. An unrevealed signal counts as a loss.",
  },
  {
    Icon: BarChart3,
    title: "Skill, not luck",
    body: "Ranking needs 30+ signals and uses the Wilson lower bound, expectancy in R, and alpha vs simply holding BTC.",
  },
  { Icon: Coins, title: "Skin in the game", body: "Providers post a bond that is slashed on losses, so coin-flip posting loses money by design." },
  { Icon: Users, title: "Real follower results", body: "Shows what followers actually made after fees and slippage, not the provider's claims." },
  { Icon: ShieldCheck, title: "Pump-and-dump protection", body: "Liquid oracle markets only, plus wallet-link monitoring and slashing." },
  {
    Icon: Receipt,
    title: "No need to trust us",
    body: "Escrow holds the funds, oracles decide outcomes, scoring is open source, and KYC comes from HSP attestations.",
  },
];

export function TrustRules() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <SectionHead
        eyebrow="Why traders can trust it"
        title={
          <>
            Seven rules a screenshot <span className="font-display font-normal italic text-muted">can&apos;t</span> follow
          </>
        }
      />
      <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TRUST_RULES.map((t, i) => (
          <li
            key={t.title}
            className={`group rounded-2xl border border-border bg-surface p-6 transition-colors hover:border-accent/40 ${i === 0 || i === TRUST_RULES.length - 1 ? "lg:col-span-2" : ""}`}
          >
            <t.Icon aria-hidden className="size-5 text-accent transition-transform duration-300 group-hover:-translate-y-0.5" />
            <h3 className="mt-6 font-semibold">{t.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">{t.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
