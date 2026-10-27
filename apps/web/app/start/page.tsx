import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Megaphone, ShoppingBag } from "lucide-react";
import { ProviderOnboarding } from "@/components/flows/ProviderOnboarding";

export const metadata: Metadata = { title: "Get started", description: "Connect a wallet and start posting or buying verified signals." };

type Props = { searchParams: Promise<{ role?: string }> };

export default async function Start({ searchParams }: Props) {
  const { role } = await searchParams;
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      {role === "provider" ? (
        <>
          <p className="text-sm text-muted">
            <Link href="/start" className="hover:text-text">
              Get started
            </Link>{" "}
            / I post signals
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Become a verified provider</h1>
          <p className="mt-2 text-muted">Every call you post is locked on-chain before the move. Your bond backs it; your record is yours.</p>
          <div className="mt-8">
            <ProviderOnboarding />
          </div>
        </>
      ) : (
        <>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">What brings you here?</h1>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <Choice
              href="/start?role=provider"
              icon={<Megaphone aria-hidden className="size-5" />}
              title="I post signals"
              body="Link your Telegram channel, get an ERC-8004 identity and a bond. Get paid when you're right."
            />
            <Choice
              href="/dashboard"
              icon={<ShoppingBag aria-hidden className="size-5" />}
              title="I buy signals"
              body="Pay only when the call is right. Wrong calls refund you automatically, plus a slice of the bond."
            />
          </div>
        </>
      )}
    </div>
  );
}

function Choice({ href, icon, title, body }: { href: string; icon: React.ReactNode; title: string; body: string }) {
  return (
    <Link href={href} className="group rounded-2xl border border-border bg-surface p-6 transition-colors hover:border-accent/50">
      <span className="grid size-10 place-items-center rounded-full bg-surface-2 text-accent">{icon}</span>
      <p className="mt-4 flex items-center gap-2 text-lg font-medium">
        {title} <ArrowRight aria-hidden className="size-4 transition-transform group-hover:translate-x-0.5" />
      </p>
      <p className="mt-1 text-sm text-muted">{body}</p>
    </Link>
  );
}
