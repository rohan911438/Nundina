import { env } from "./env.js";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
let fetchImpl: Fetch = (u, i) => fetch(u, i);
/** Tests route API calls in-process. */
export const setApiFetch = (f: Fetch) => {
  fetchImpl = f;
};

/** Thin client for the Nundina API; the MCP server adds no business logic. */
export class Nundina {
  constructor(
    /** Caller's agent API key (`nk_…`), forwarded as a bearer token; undefined for public calls. */
    readonly apiKey?: string,
    private readonly headers: Record<string, string> = {},
  ) {}

  async req<T = any>(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<T> {
    const res = await fetchImpl(`${env().API_URL}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        ...this.headers,
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) throw new ApiError(res.status, json.error?.code ?? "http_error", json.error?.message ?? `${method} ${path}: HTTP ${res.status}`);
    return json as T;
  }

  get = <T = any>(path: string) => this.req<T>("GET", path);
  post = <T = any>(path: string, body?: unknown, extra?: Record<string, string>) => this.req<T>("POST", path, body, extra);
}
