import { Check, CircleDashed, EyeOff, Lock, Minus, RotateCcw, X, Radio } from "lucide-react";
import { cn } from "@/lib/cn";
import { STATE_LABEL, type SignalState } from "@/lib/signal-state";

const STYLE: Record<SignalState, { cls: string; Icon: typeof Lock }> = {
  locked: { cls: "text-locked border-locked/35 bg-locked/10", Icon: Lock },
  live: { cls: "text-accent border-accent/35 bg-accent/10", Icon: Radio },
  resolving: { cls: "text-muted border-border bg-surface-2", Icon: CircleDashed },
  win: { cls: "text-win border-win/35 bg-win/10", Icon: Check },
  loss: { cls: "text-loss border-loss/35 bg-loss/10", Icon: X },
  unrevealed: { cls: "text-loss border-loss/35 bg-loss/10", Icon: EyeOff },
  void: { cls: "text-void border-void/35 bg-void/10", Icon: Minus },
  refunded: { cls: "text-void border-void/35 bg-void/10", Icon: RotateCcw },
};

export function SignalStatusPill({ state, className, size = "sm" }: { state: SignalState; className?: string; size?: "sm" | "md" }) {
  const { cls, Icon } = STYLE[state];
  return (
    <span
      data-state={state}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border font-medium",
        size === "sm" ? "h-6 px-2 text-xs" : "h-8 px-3 text-sm",
        cls,
        className,
      )}
    >
      <Icon aria-hidden className={size === "sm" ? "size-3" : "size-3.5"} strokeWidth={2.5} />
      {STATE_LABEL[state]}
    </span>
  );
}
