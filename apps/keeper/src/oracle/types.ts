import type { Hex } from "viem";
import type { Level, WatchedSignal } from "../detectors/touch.js";

export interface TouchProof {
  proof: Hex;
  price: bigint;
  ts: number;
}

export type ExpiryArgs = { kind: "hint"; hint: bigint } | { kind: "proof"; proof: Hex };

/**
 * Where proofs come from. Local/testnet: the MockPriceAdapter, for which the keeper is the price
 * updater. Mainnet: APRO/Supra push feeds for expiry and Supra pull proofs for touches.
 */
export interface Oracle {
  readonly kind: "mock" | "live";
  /**
   * A proof that `level` was touched, backed by an oracle price. `observed` is what the exchange
   * feed saw; the returned proof may carry a different price/time. Null = no proof-backed crossing yet.
   */
  touchProof(w: WatchedSignal, level: Level, observed: { price: bigint; ts: number }): Promise<TouchProof | null>;
  /** Whether `touchProof` can produce a proof for a past time (challenges, catch-up after downtime). */
  readonly canProveHistory: boolean;
  /** Ways to price `validUntil`, best first. */
  expiryArgs(market: Hex, validUntil: number, now: number): Promise<ExpiryArgs[]>;
  /** Periodic work (the mock oracle pushes price rounds). */
  tick?(now: number): Promise<void>;
}
