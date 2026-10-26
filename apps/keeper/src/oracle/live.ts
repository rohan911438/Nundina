/**
 * Mainnet oracle: expiry from the push feed (APRO → Supra push fallback adapter) when its latest
 * round is at or before `validUntil`; otherwise a Supra pull proof taken within 5 minutes of expiry.
 * Touch proofs are Supra pull proofs (only when `touchProofsEnabled`, off on mainnet for now).
 */
import type { Address, Hex, PublicClient } from "viem";
import { MARKETS, marketById } from "@nundina/shared";
import { entryCrossed, ENTRY, levelCrossed, type Level, type WatchedSignal } from "../detectors/touch.js";
import { latestRound } from "../feeds/apro.js";
import type { SupraProofClient } from "../proofs/supra.js";
import type { ExpiryArgs, Oracle, TouchProof } from "./types.js";

const verifyAbi = [
  {
    type: "function",
    name: "verifyTouch",
    stateMutability: "nonpayable",
    inputs: [
      { name: "market", type: "bytes32" },
      { name: "proof", type: "bytes" },
    ],
    outputs: [
      { name: "price8", type: "uint256" },
      { name: "ts", type: "uint64" },
    ],
  },
] as const;

/** Resolver accepts an expiry proof timestamped in [validUntil, validUntil + 5 min]. */
const EXPIRY_PROOF_TOLERANCE_S = 5 * 60;

export class LiveOracle implements Oracle {
  readonly kind = "live" as const;
  readonly canProveHistory = false;

  constructor(
    private readonly pub: PublicClient,
    private readonly touchVerifier: Address,
    private readonly supra: SupraProofClient | null,
  ) {}

  /** Fetches the latest Supra proof and checks (by simulating the verifier) that it really crosses. */
  private async verifiedProof(market: Hex): Promise<TouchProof | null> {
    const pair = marketById(market)?.supraPairId;
    if (!this.supra || pair == null) return null;
    const proof = await this.supra.latestProof(pair);
    const { result } = await this.pub.simulateContract({ address: this.touchVerifier, abi: verifyAbi, functionName: "verifyTouch", args: [market, proof] });
    return { proof, price: result[0], ts: Number(result[1]) };
  }

  async touchProof(w: WatchedSignal, level: Level): Promise<TouchProof | null> {
    const p = await this.verifiedProof(w.s.market);
    if (!p || p.ts < w.committedAt || p.ts > w.validUntil) return null;
    const crossed = level === ENTRY ? entryCrossed(w, p.price) : levelCrossed(w.s, level, p.price);
    return crossed ? p : null;
  }

  async expiryArgs(market: Hex, validUntil: number, now: number): Promise<ExpiryArgs[]> {
    const out: ExpiryArgs[] = [];
    const info = marketById(market);
    const feed = info && MARKETS[info.label as keyof typeof MARKETS]?.aproFeed;
    if (feed) {
      const r = await latestRound(this.pub, feed).catch(() => null);
      // the adapter prices with its latest round when that round is not newer than validUntil
      if (r && r.updatedAt <= validUntil) out.push({ kind: "hint", hint: r.roundId });
      else out.push({ kind: "hint", hint: 0n }); // the Supra push fallback may still answer
    }
    if (now <= validUntil + EXPIRY_PROOF_TOLERANCE_S) {
      const p = await this.verifiedProof(market).catch(() => null);
      if (p && p.ts >= validUntil && p.ts <= validUntil + EXPIRY_PROOF_TOLERANCE_S) out.push({ kind: "proof", proof: p.proof });
    }
    return out;
  }
}
