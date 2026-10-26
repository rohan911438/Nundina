import type {
  ApiCandle,
  ApiContracts,
  ApiPage,
  ApiProvider,
  ApiProviderDetail,
  ApiSignal,
  ApiSignalDetail,
  ApiStats,
} from "@nundina/shared";
import { config } from "./config";

/** Typed fetchers for the public API. Server components call them directly; client parts use `queries.ts`. */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

function qs(q?: Query) {
  if (!q) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v != null && v !== "" && v !== false) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** `revalidate` seconds of Next's data cache on the server; ignored in the browser. */
export async function get<T>(path: string, q?: Query, revalidate = 30): Promise<T> {
  const res = await fetch(`${config.apiUrl}${path}${qs(q)}`, {
    headers: { accept: "application/json" },
    ...(typeof window === "undefined" ? { next: { revalidate } } : {}),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
    throw new ApiError(res.status, body?.error?.code ?? "http_error", body?.error?.message ?? res.statusText);
  }
  return (await res.json()) as T;
}

export interface ProvidersFilter {
  market?: string;
  period?: "7d" | "30d" | "all";
  type?: "human" | "agent" | "aggregator";
  verified?: boolean;
  observed?: boolean;
  sort?: "score" | "wilson" | "expectancy" | "alpha" | "n" | "pnl" | "newest";
  limit?: number;
  cursor?: string;
}

export const api = {
  stats: () => get<ApiStats>("/stats"),
  providers: (f: ProvidersFilter = {}) => get<ApiPage<ApiProvider>>("/providers", { ...f }),
  provider: (handle: string) => get<ApiProviderDetail>(`/providers/${encodeURIComponent(handle)}`),
  providerSignals: (handle: string, q: { limit?: number; cursor?: string; status?: string } = {}) =>
    get<ApiPage<ApiSignal>>(`/providers/${encodeURIComponent(handle)}/signals`, q),
  signals: (q: { status?: string; market?: string; provider?: string; limit?: number; cursor?: string } = {}) =>
    get<ApiPage<ApiSignal>>("/signals", q, 15),
  signal: (id: string) => get<ApiSignalDetail>(`/signals/${encodeURIComponent(id)}`, undefined, 15),
  prices: (q: { market: string; interval?: string; from?: number; to?: number }) =>
    get<{ market: string; interval: string; candles: ApiCandle[] }>("/prices", q, 60),
  contracts: () => get<ApiContracts>("/contracts", undefined, 300),
};

/** Settled statuses as the API stores them (used for the ticker and history filters). */
export const SETTLED_STATUSES = "SETTLED,REFUNDED,UNREVEALED_LOSS,VOID";
export const LIVE_STATUSES = "COMMITTED,LIVE,TOUCH_PENDING";

export const isNotFound = (e: unknown) => e instanceof ApiError && e.status === 404;
