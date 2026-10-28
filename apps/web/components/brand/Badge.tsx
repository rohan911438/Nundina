import { AlertTriangle, BadgeCheck, Bot, Eye, Hourglass, Layers, Send, Wallet } from "lucide-react";
import { cn } from "@/lib/cn";

export type BadgeKind = "verified" | "agent" | "aggregator" | "probation" | "ownCalls" | "observed" | "practice" | "channel" | "lookalike";

const BADGES: Record<BadgeKind, { label: string; title: string; Icon: typeof Bot; cls: string }> = {
  verified: { label: "Verified", title: "KYC attested through HSP", Icon: BadgeCheck, cls: "text-accent" },
  agent: { label: "Agent", title: "An AI strategy agent posts these signals", Icon: Bot, cls: "text-text" },
  aggregator: { label: "Aggregator", title: "Blends other providers' signals; wins pay upstream", Icon: Layers, cls: "text-text" },
  probation: { label: "Probation", title: "Fewer than 30 settled signals: not ranked yet", Icon: Hourglass, cls: "text-locked" },
  ownCalls: { label: "Trades own calls", title: "Provider wallet trades its own signals", Icon: Wallet, cls: "text-win" },
  observed: { label: "Observed", title: "Scored from a public channel; not committed on-chain", Icon: Eye, cls: "text-muted" },
  practice: { label: "Practice", title: "Practice profile: no payments", Icon: Hourglass, cls: "text-muted" },
  channel: { label: "Channel verified", title: "Telegram confirms this provider owns or admins the linked channel", Icon: Send, cls: "text-win" },
  lookalike: { label: "Lookalike name", title: "The channel name resembles an earlier provider: make sure this is who you think", Icon: AlertTriangle, cls: "text-loss border-loss/40" },
};

export function Badge({ kind, className, compact }: { kind: BadgeKind; className?: string; compact?: boolean }) {
  const b = BADGES[kind];
  return (
    <span
      title={b.title}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-xs font-medium",
        b.cls,
        className,
      )}
    >
      <b.Icon aria-hidden className="size-3" strokeWidth={2.4} />
      {compact ? <span className="sr-only">{b.label}</span> : b.label}
    </span>
  );
}

/** The badges a provider earns, in display order. */
export function providerBadges(p: {
  verified: boolean;
  kind: string;
  observed: boolean;
  isPractice: boolean;
  score: { probation: boolean };
  channel?: unknown;
  lookalikeOf?: string | null;
}) {
  const out: BadgeKind[] = [];
  if (p.lookalikeOf) out.push("lookalike");
  if (p.verified) out.push("verified");
  if (p.channel) out.push("channel");
  if (p.kind === "agent") out.push("agent");
  if (p.kind === "aggregator") out.push("aggregator");
  if (p.observed) out.push("observed");
  if (p.isPractice) out.push("practice");
  if (p.score.probation) out.push("probation");
  return out;
}
