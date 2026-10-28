import type { Metadata } from "next";
import { RedeemTelegramLink } from "@/components/flows/RedeemTelegramLink";

export const metadata: Metadata = { title: "Connect Telegram", description: "Link your Telegram account to your wallet." };

type Props = { searchParams: Promise<{ t?: string }> };

/** Target of the bot's /connect link: sign in with the wallet and the Telegram account is linked to it. */
export default async function Connect({ searchParams }: Props) {
  const { t } = await searchParams;
  return (
    <div className="mx-auto max-w-xl px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Connect Telegram</h1>
      <p className="mt-2 text-muted">Link the Telegram account that opened this page to your wallet. Purchases, unlocks and your channel then use one account.</p>
      <div className="mt-8">
        <RedeemTelegramLink token={t ?? null} />
      </div>
    </div>
  );
}
