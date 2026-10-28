"use client";

import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { telegramApi } from "@/lib/session";
import { TelegramConnect } from "./TelegramConnect";
import { WalletGate } from "./WalletGate";

/** Finishes a link the bot started: one-time token from `/connect` in Telegram. */
export function RedeemTelegramLink({ token }: { token: string | null }) {
  return (
    <WalletGate title="Sign in with the wallet to link" needKey={false}>
      {token ? <Redeem token={token} /> : <TelegramConnect hint="Open this page from the bot's /connect, or link from here: Telegram opens and you tap Start." />}
    </WalletGate>
  );
}

function Redeem({ token }: { token: string }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => telegramApi.redeem(token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["session"] }),
  });
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    m.mutate();
  }, [m]);

  if (m.isSuccess) {
    return (
      <div className="rise space-y-3 rounded-2xl border border-win/30 bg-win/[0.06] p-5" data-testid="telegram-linked">
        <p className="flex items-center gap-2 font-medium text-win">
          <Check aria-hidden className="size-4" /> Telegram {m.data.telegramUsername ? `@${m.data.telegramUsername}` : ""} is linked to this wallet
        </p>
        <p className="text-sm text-muted">Go back to Telegram: the bot now knows your wallet. Providers can verify their channel next.</p>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/start?role=provider">Provider setup</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/dashboard">My signals</Link>
          </Button>
        </div>
      </div>
    );
  }
  if (m.isError) {
    return (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-loss">
          {m.error instanceof ApiError ? m.error.message : "Couldn't link Telegram. Try again."}
        </p>
        <TelegramConnect hint="Or link from here:" />
      </div>
    );
  }
  return (
    <p className="flex items-center gap-2 text-sm text-muted">
      <Loader2 aria-hidden className="size-4 animate-spin" /> Linking…
    </p>
  );
}
