import type { ApiSignal } from "@nundina/shared";

/** The one state a signal page/card is laid out for. */
export type SignalState = "locked" | "live" | "resolving" | "win" | "loss" | "unrevealed" | "void" | "refunded";

const LIVE = new Set(["COMMITTED", "LIVE", "TOUCH_PENDING"]);

export function signalState(s: Pick<ApiSignal, "status" | "outcome" | "revealed">): SignalState {
  if (s.status === "UNREVEALED_LOSS") return "unrevealed";
  if (s.outcome === "WIN") return "win";
  if (s.outcome === "LOSS") return "loss";
  if (s.outcome === "VOID" || s.status === "VOID") return "void";
  // refund sweep: no oracle price for the expiry, everyone got their money back
  if (s.status === "REFUNDED") return "refunded";
  if (s.status === "RESOLVED") return "resolving";
  if (LIVE.has(s.status)) return s.revealed ? "live" : "locked";
  return "resolving";
}

export const STATE_LABEL: Record<SignalState, string> = {
  locked: "Locked",
  live: "Live",
  resolving: "Resolving",
  win: "Win",
  loss: "Loss",
  unrevealed: "Unrevealed · loss",
  void: "Void",
  refunded: "Refunded",
};

/** Open for purchase: live on-chain and not past `validUntil` (the escrow refuses later payments). */
export function isBuyable(s: Pick<ApiSignal, "status" | "validUntil">, now = Date.now()) {
  return LIVE.has(s.status) && new Date(s.validUntil).getTime() > now;
}

export const isSettled = (st: SignalState) => st === "win" || st === "loss" || st === "unrevealed" || st === "void" || st === "refunded";
