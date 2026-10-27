import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Bot, Megaphone, ShoppingBag } from "lucide-react";
import type { ReactNode } from "react";
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
          <h1 className="rise text-3xl font-semibold tracking-tight sm:text-4xl">What brings you here?</h1>
          <p className="rise mt-2 text-muted [animation-delay:60ms]">Pick one; you can do the others later with the same wallet.</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <Choice
              i={0}
              href="/start?role=provider"
              icon={<Megaphone aria-hidden className="size-5" />}
              title="I post signals"
              body="Link your Telegram channel, get an ERC-8004 identity and a bond. Get paid when you're right."
            />
            <Choice
              i={1}
              href="/leaderboard"
              icon={<ShoppingBag aria-hidden className="size-5" />}
              title="I buy signals"
              body="Pick a provider by their on-chain record. Wrong calls refund you automatically, plus a slice of the bond."
              secondary={{ href: "/dashboard", label: "Already bought? My signals" }}
            />
            <Choice
              i={2}
              href="/dashboard/agents"
              icon={<Bot aria-hidden className="size-5" />}
              title="I run an AI agent"
              body="Give an agent a budget to buy signals through HSP, or let it sell its own calls. MCP tools included."
              secondary={{ href: "/#agents", label: "How agents connect" }}
            />
          </div>
        </>
      )}
    </div>
  );
}

function Choice(p: { i: number; href: string; icon: ReactNode; title: string; body: string; secondary?: { href: string; label: string } }) {
  return (
    <div className="rise flex flex-col" style={{ animationDelay: `${120 + p.i * 80}ms` }}>
      <Link
        href={p.href}
        className="group relative flex-1 overflow-hidden rounded-2xl border border-border bg-surface p-6 transition-[border-color,box-shadow,translate] duration-300 hover:-translate-y-1 hover:border-accent/50 hover:shadow-[0_24px_50px_-28px_var(--glow)]"
      >
        <span aria-hidden className="absolute inset-x-0 -top-px h-px scale-x-0 bg-gradient-to-r from-transparent via-accent to-transparent transition-transform duration-500 group-hover:scale-x-100" />
        <span className="grid size-10 place-items-center rounded-full bg-surface-2 text-accent transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6">{p.icon}</span>
        <p className="mt-4 flex items-center gap-2 text-lg font-medium">
          {p.title} <ArrowRight aria-hidden className="size-4 transition-transform group-hover:translate-x-1" />
        </p>
        <p className="mt-1 text-sm text-muted">{p.body}</p>
      </Link>
      {p.secondary ? (
        <Link href={p.secondary.href} className="mt-2 px-1 text-xs text-muted transition-colors hover:text-accent">
          {p.secondary.label} →
        </Link>
      ) : null}
    </div>
  );
}
