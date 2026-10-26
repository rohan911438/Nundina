"use client";

import type { ChartLevels } from "@/components/signal/PriceChart";

export interface UnlockedSignal extends ChartLevels {
  side: "LONG" | "SHORT";
}

/**
 * The decrypted signal if the connected viewer bought it. Prompt 12 fills this in (wallet → own
 * purchases → key from the API → decrypt locally); until then nobody is "unlocked".
 */
export function useUnlockedSignal(_id: string): UnlockedSignal | null {
  return null;
}
