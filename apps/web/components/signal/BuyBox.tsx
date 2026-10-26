import { Send, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { config } from "@/lib/config";
import { ago, usd } from "@/lib/format";

/**
 * Live signal checkout. For now Buy opens the Telegram bot (`/start buy_<id>` → Mini App); the
 * in-browser wallet checkout replaces it in prompt 12.
 */
export function BuyBox({ id, priceUsd, validUntil, purchaseCount }: { id: string; priceUsd: string; validUntil: string; purchaseCount: number }) {
  return (
    <div data-testid="buy-box" className="rounded-2xl border border-locked/30 bg-locked/[0.06] p-5">
      <div className="flex items-baseline justify-between">
        <p className="text-sm text-muted">Price</p>
        <p className="num text-3xl font-medium">{usd(priceUsd)}</p>
      </div>
      <ul className="mt-4 space-y-2 text-sm">
        <li className="flex gap-2">
          <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-win" />
          <span>
            <strong className="font-medium">Refund if wrong.</strong> <span className="text-muted">Your payment waits in escrow until the oracle decides.</span>
          </span>
        </li>
        <li className="flex justify-between text-muted">
          <span>Expires</span>
          <span className="num">{ago(validUntil)}</span>
        </li>
        <li className="flex justify-between text-muted">
          <span>Bought so far</span>
          <span className="num">{purchaseCount}</span>
        </li>
      </ul>
      <Button asChild variant="accent" size="lg" className="mt-5 w-full">
        <a href={`https://t.me/${config.botUsername}?start=buy_${id}`} target="_blank" rel="noreferrer noopener">
          <Send aria-hidden /> Buy in Telegram
        </a>
      </Button>
      <p className="mt-3 text-center text-xs text-muted">Paid through HSP · key delivered instantly</p>
    </div>
  );
}
