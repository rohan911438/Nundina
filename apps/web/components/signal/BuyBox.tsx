"use client";

import { Send, ShieldCheck, Wallet } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import type { ApiSignalDetail } from "@nundina/shared";
import { Button } from "@/components/ui/button";
import { config } from "@/lib/config";
import { ago, usd } from "@/lib/format";

const WalletBuy = dynamic(() => import("./WalletBuy"), {
  ssr: false,
  loading: () => <div className="h-80 animate-pulse rounded-2xl bg-surface" />,
});

/** Live signal checkout: in the browser with a wallet, or through the Telegram bot (Mini App). */
export function BuyBox({ signal }: { signal: ApiSignalDetail }) {
  const [open, setOpen] = useState(false);
  if (open) return <WalletBuy signal={signal} />;
  const free = Number(signal.priceUsd) === 0;
  return (
    <div data-testid="buy-box" className="rounded-2xl border border-locked/30 bg-locked/[0.06] p-5">
      <div className="flex items-baseline justify-between">
        <p className="text-sm text-muted">Price</p>
        <p className="num text-3xl font-medium">{free ? "Free" : usd(signal.priceUsd)}</p>
      </div>
      <ul className="mt-4 space-y-2 text-sm">
        <li className="flex gap-2">
          <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-win" />
          <span>
            {free ? (
              <>
                <strong className="font-medium">Locked before the move.</strong> <span className="text-muted">The oracle settles it on-chain; nothing to pay.</span>
              </>
            ) : (
              <>
                <strong className="font-medium">Refund if wrong.</strong> <span className="text-muted">Your payment waits in escrow until the oracle decides.</span>
              </>
            )}
          </span>
        </li>
        <li className="flex justify-between text-muted">
          <span>Expires</span>
          <span className="num">{ago(signal.validUntil)}</span>
        </li>
        <li className="flex justify-between text-muted">
          <span>Bought so far</span>
          <span className="num">{signal.purchaseCount}</span>
        </li>
      </ul>
      <Button variant="accent" size="lg" className="mt-5 w-full" onClick={() => setOpen(true)} data-testid="buy-wallet">
        <Wallet aria-hidden /> {free ? "Unlock free with wallet" : "Buy with wallet"}
      </Button>
      {config.botUsername ? (
        <Button asChild variant="outline" size="lg" className="mt-2 w-full">
          <a href={`https://t.me/${config.botUsername}?start=buy_${signal.id}`} target="_blank" rel="noreferrer noopener">
            <Send aria-hidden /> {free ? "Get it in Telegram" : "Buy in Telegram"}
          </a>
        </Button>
      ) : null}
      <p className="mt-3 text-center text-xs text-muted">{free ? "Free practice signal" : "Paid through HSP"} · key delivered instantly</p>
    </div>
  );
}
