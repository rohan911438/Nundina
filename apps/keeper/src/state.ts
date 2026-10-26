/**
 * Candidate signals (from the API's DB) and their plaintext (from the API's key service).
 * Plaintext lives in memory only: never logged, never written to disk.
 */
import { deserializeSignal, type SerializedSignal, type Signal } from "@nundina/shared";

export interface Candidate {
  id: string;
  market: string;
  marketId: string;
  status: string;
  validUntil: number;
  committedAt: number;
  hasMaterial: boolean;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export class KeeperApi {
  constructor(
    private readonly baseUrl: string,
    private readonly secret: string,
    private readonly fetchImpl: FetchLike = (u, i) => fetch(u, i),
  ) {}

  private async get(path: string) {
    return this.fetchImpl(`${this.baseUrl}${path}`, { headers: { "x-internal-secret": this.secret }, signal: AbortSignal.timeout(10_000) });
  }

  async candidates(): Promise<Candidate[]> {
    const res = await this.get("/internal/keeper/signals");
    if (!res.ok) throw new Error(`candidates ${res.status}`);
    return ((await res.json()) as { items: Candidate[] }).items;
  }

  /** Plaintext signal + salt, or null when the API has no material (committed outside the app). */
  async material(id: string): Promise<Signal | null> {
    const res = await this.get(`/internal/signals/${id}/reveal-material`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`reveal material ${res.status}`);
    return deserializeSignal((await res.json()) as SerializedSignal);
  }
}
