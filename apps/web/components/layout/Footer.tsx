import Link from "next/link";
import { api } from "@/lib/api";
import { config } from "@/lib/config";
import { explorer, short } from "@/lib/format";
import { ExternalLink } from "@/components/ui/external";
import { LogoMark } from "@/components/brand/Logo";

/** Contracts shown in the footer, in the order a skeptic would check them. */
const SHOWN = ["SignalBook", "PerformanceEscrow", "OutcomeResolver", "RevenueRouter", "ProviderRegistry", "IdentityRegistry"];

async function contracts() {
  try {
    const c = await api.contracts();
    return { chainId: c.chainId, list: SHOWN.flatMap((n) => (typeof c.addresses[n] === "string" ? [[n, c.addresses[n] as string] as const] : [])) };
  } catch {
    return { chainId: config.chainId, list: [] };
  }
}

export async function Footer() {
  const c = await contracts();
  return (
    <footer className="relative mt-24 overflow-hidden border-t border-border">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 pb-10 pt-14 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1.4fr]">
        <div className="max-w-xs">
          <p className="flex items-center gap-2 font-semibold">
            <LogoMark /> nundina
          </p>
          <p className="mt-3 text-sm text-muted">Verified, pay-if-right trading signals, settled agent-to-agent on HashKey Chain through HSP.</p>
        </div>
        <FooterCol title="Product">
          <Link href="/leaderboard">Leaderboard</Link>
          <Link href="/#how">How it works</Link>
          <Link href="/#agents">For agents</Link>
          <Link href="/legal">Legal</Link>
        </FooterCol>
        <FooterCol title="Community">
          <a href={`https://t.me/${config.botUsername}`} target="_blank" rel="noreferrer noopener">
            Telegram bot
          </a>
          <a href={config.githubUrl} target="_blank" rel="noreferrer noopener">
            GitHub
          </a>
        </FooterCol>
        <FooterCol title={`Contracts · chain ${c.chainId}`}>
          {c.list.length ? (
            c.list.map(([name, addr]) => (
              <span key={name} className="flex items-baseline justify-between gap-3">
                <span>{name}</span>
                <ExternalLink href={explorer.address(addr, c.chainId)} className="text-xs text-muted" label={`${name} on explorer`}>
                  {short(addr)}
                </ExternalLink>
              </span>
            ))
          ) : (
            <span className="text-muted">Addresses load from the API.</span>
          )}
        </FooterCol>
      </div>
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <p className="border-t border-border py-6 text-xs leading-relaxed text-muted">
          Nundina is verification infrastructure, not investment advice. Signals are the opinions of their providers. Trading crypto
          assets is risky and you can lose money. <Link href="/legal" className="underline underline-offset-4 hover:text-text">Read the full disclaimer</Link>.
        </p>
      </div>
      {/* decorative wordmark; SVG so it is neither read out nor contrast-checked as text */}
      <svg aria-hidden viewBox="0 0 1000 230" className="mask-fade-b pointer-events-none -mb-[3%] block w-full select-none">
        <text x="500" y="200" textAnchor="middle" className="fill-text/[0.06] font-display" fontSize="270">
          nundina
        </text>
      </svg>
    </footer>
  );
}

function FooterCol({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-xs font-medium uppercase tracking-wider text-muted">{title}</h2>
      <div className="mt-4 flex flex-col gap-2.5 text-sm [&_a]:transition-colors [&_a:hover]:text-accent">{children}</div>
    </div>
  );
}
