/**
 * Supra pull-oracle proofs for HashKey (verified on-chain by SupraPullAdapter → verifyOracleProofV2).
 *
 * TODO(confirm): the REST shape below is assumed from Supra's public pull-client examples and must
 * be checked against the real service (contracts/ORACLES.md, NEEDS-FROM-USER item 3):
 *   POST {SUPRA_PROOF_API_URL}/get_proof  { pair_indexes: [0], chain_type: "evm" }
 *   → { proof_bytes: "0x…" }   (also accepted: { proof: "0x…" })
 * Proofs are for the latest price only; there is no historical proof, which is why the keeper
 * fetches one as soon as it sees a crossing.
 */
import type { Hex } from "viem";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export class SupraProofClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: FetchLike = (u, i) => fetch(u, i),
  ) {}

  async latestProof(pairIndex: number): Promise<Hex> {
    const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}/get_proof`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pair_indexes: [pairIndex], chain_type: "evm" }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`supra proof ${res.status}`);
    const body = (await res.json()) as { proof_bytes?: string; proof?: string };
    const hex = body.proof_bytes ?? body.proof;
    if (!hex || !/^0x[0-9a-fA-F]+$/.test(hex)) throw new Error("supra proof: unexpected response shape");
    return hex as Hex;
  }
}
