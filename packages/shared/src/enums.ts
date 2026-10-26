export enum Side {
  LONG = 0,
  SHORT = 1,
}

export enum SignalStatus {
  COMMITTED = 0,
  LIVE = 1,
  TOUCH_PENDING = 2,
  RESOLVED = 3,
  SETTLED = 4,
  REVEALED = 5,
  UNREVEALED_LOSS = 6,
  REFUNDED = 7,
  VOID = 8,
}

export enum Outcome {
  NONE = 0,
  WIN = 1,
  LOSS = 2,
  VOID = 3,
}

export enum Level {
  TP = 0,
  SL = 1,
  ENTRY = 2,
}

export enum PurchaseStatus {
  PENDING = "pending",
  PAID = "paid",
  CREDITED = "credited",
  KEY_DELIVERED = "key_delivered",
  SETTLED_WIN = "settled_win",
  REFUNDED = "refunded",
  FAILED = "failed",
}

export const sideLabel = (s: Side) => (s === Side.LONG ? "LONG" : "SHORT");
export const outcomeLabel = (o: Outcome) => ["NONE", "WIN", "LOSS", "VOID"][o] ?? "NONE";
