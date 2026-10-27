"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { WalletProviders } from "@/components/wallet/WalletProviders";
import { TelegramProvider } from "@/lib/telegram";

/** Where each Mini App screen lives on the web, for links opened outside Telegram. */
export function webEquivalent(path: string): string | null {
  const buy = path.match(/^\/tg\/buy\/(\d+)/);
  if (buy) return `/s/${buy[1]}`;
  if (path.startsWith("/tg/my")) return "/dashboard";
  if (path.startsWith("/tg/connect")) return "/start";
  // the confirm screen has no web twin; it works in a normal browser too
  return null;
}

export function TgShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const qs = useSearchParams();
  const onOutside = () => {
    if (qs.get("web") === "1") return;
    const to = webEquivalent(path);
    if (to) router.replace(to);
  };
  return (
    <div data-tg-app className="px-4 pb-24 pt-4">
      <TelegramProvider onOutside={onOutside}>
        <WalletProviders>{children}</WalletProviders>
      </TelegramProvider>
    </div>
  );
}
