"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address, Hex } from "viem";
import { fromPrice } from "@nundina/shared/money";
import { marketById } from "@nundina/shared/signal";
import type { ChartLevels } from "@/components/signal/PriceChart";
import { decryptDelivery, loadKey } from "./crypto/encKey";
import { me, purchasesApi, type PurchaseView } from "./session";

export interface UnlockedSignal extends ChartLevels {
  side: "LONG" | "SHORT";
  market: string;
  validUntil: string;
}

/** Statuses with a delivered key. */
export const KEYED_STATUSES = ["KEY_SENT", "SETTLED_WIN", "REFUNDED"];

interface Body {
  market: string;
  side: number;
  entry: string;
  takeProfit: string;
  stopLoss: string;
  validUntil: string;
}

/** Fetches the wrapped key and decrypts the signal locally. Plaintext never leaves the device. */
export async function decryptPurchase(purchaseId: string, privateKey: Hex): Promise<UnlockedSignal> {
  const d = await purchasesApi.key(purchaseId);
  const b = decryptDelivery<Body>(privateKey, d);
  return {
    side: b.side === 0 ? "LONG" : "SHORT",
    market: marketById(b.market)?.label ?? b.market,
    entry: fromPrice(BigInt(b.entry)),
    takeProfit: fromPrice(BigInt(b.takeProfit)),
    stopLoss: fromPrice(BigInt(b.stopLoss)),
    validUntil: new Date(Number(b.validUntil) * 1000).toISOString(),
  };
}

/** The viewer's purchase of a signal, if signed in. */
export function useMyPurchase(signalId: string) {
  const session = useQuery({ queryKey: ["session"], queryFn: me.session, staleTime: 60_000, retry: false });
  const wallet = session.data?.wallet ?? null;
  const subs = useQuery({
    queryKey: ["subscriber"],
    queryFn: me.subscriber,
    enabled: Boolean(wallet),
    staleTime: 15_000,
    retry: false,
  });
  const purchase: PurchaseView | undefined = subs.data?.purchases.find((p) => p.signalId === signalId);
  return { wallet, purchase };
}

/**
 * The decrypted signal if the signed-in viewer bought it and their key is in this browser
 * session; otherwise null (the page keeps its locked layout).
 */
export function useUnlockedSignal(id: string): UnlockedSignal | null {
  const { wallet, purchase } = useMyPurchase(id);
  const key = wallet ? loadKey(wallet as Address) : null;
  const q = useQuery({
    queryKey: ["unlocked", id, purchase?.id],
    queryFn: () => decryptPurchase(purchase!.id, key!.privateKey),
    enabled: Boolean(purchase && key && KEYED_STATUSES.includes(purchase.status)),
    staleTime: Infinity,
    retry: false,
  });
  return q.data ?? null;
}
