"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { WalletGate } from "@/components/flows/WalletGate";
import { short } from "@/lib/format";
import { useMainButton, useTelegram } from "@/lib/telegram";
import { useWallet } from "@/lib/wallet/useWallet";

/** Links the Telegram account to a wallet: SIWE carries initData, so the API ties the two together. */
export default function TgConnect() {
  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-xl font-semibold">Connect your wallet</h1>
      <WalletGate title="Link a wallet to your Telegram account">
        <Linked />
      </WalletGate>
    </div>
  );
}

function Linked() {
  const w = useWallet();
  const tg = useTelegram();
  useMainButton(tg.inTelegram ? "Done" : null, tg.close);
  return (
    <div className="rounded-2xl border border-win/30 bg-win/[0.06] p-5" data-testid="connected">
      <p className="flex items-center gap-2 font-medium text-win">
        <Check aria-hidden className="size-5" /> Wallet linked
      </p>
      <p className="num mt-2 text-sm text-muted">{short(w.address)}</p>
      <p className="mt-3 text-sm">
        Buy signals from any locked card, or see your purchases in{" "}
        <Link href="/tg/my" className="text-accent hover:underline">
          My signals
        </Link>
        .
      </p>
    </div>
  );
}
