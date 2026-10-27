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

export interface SignalView {
  id: string;
  provider: { handle: string; displayName: string; kind: string } | null;
  market: string;
  status: string;
  outcome: string | null;
  priceUsd: string;
  validUntil: string;
  committedAt: string;
  oraclePriceAtCommit: string | null;
  purchaseCount: number;
}
export interface ProviderView {
  handle: string;
  address: string;
  kind: string;
  bondUsd: string;
  score: { score: number | null; probation: boolean; n: number };
}
export interface AgentView {
  id: number;
  name: string;
  type: string;
  wallet: string | null;
  paused: boolean;
  ownerUserId?: number;
  policy: {
    dailyBudgetUsd: string | null;
    maxPerSignalUsd: string | null;
    minScore: number | null;
    markets: string[];
    providersAllow: string[];
    providersDeny: string[];
    autoTrade: boolean;
    slippageBps: number;
  };
  spentTodayUsd: string;
}
export interface MandateTypedData {
  domain: { name: string; version: string; chainId: number | string; verifyingContract: `0x${string}` };
  types: Record<string, { name: string; type: string }[]>;
  primaryType: "Mandate";
  message: Record<string, string> & { token: `0x${string}`; payee: `0x${string}`; amount: string; chainId: string; deadline: string };
}
export interface PurchaseView {
  id: string;
  signalId: string;
  status: string;
  amount: string;
  txHash: string | null;
  rejectReason: string | null;
}

/**
 * Typed client for the Nundina API. Our agents are trusted processes: they authenticate with the
 * internal secret and act as their agent row (`X-Act-As-Agent`), which pays from the agent wallet
 * and wraps signal keys to the agent's encryption key.
 */
export class Nundina {
  constructor(
    readonly agentId?: number,
    private readonly base = env().API_URL,
    private readonly secret = env().INTERNAL_SECRET,
  ) {}

  as(agentId: number) {
    return new Nundina(agentId, this.base, this.secret);
  }

  async req<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-internal-secret": this.secret,
        ...(this.agentId ? { "x-act-as-agent": String(this.agentId) } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) throw new ApiError(res.status, json.error?.code ?? json.code ?? "http_error", json.error?.message ?? json.message ?? `${method} ${path}: HTTP ${res.status}`);
    return json as T;
  }

  // public
  liveSignals(market?: string) {
    const q = new URLSearchParams({ status: "COMMITTED", limit: "100", ...(market ? { market } : {}) });
    return this.req<{ items: SignalView[] }>("GET", `/signals?${q}`).then((r) => r.items);
  }
  provider(handle: string) {
    return this.req<ProviderView>("GET", `/providers/${handle}`);
  }

  // agent bootstrap and state
  register(b: { name: string; type: "strategy" | "aggregator" | "execution"; wallet: string; provider?: { handle: string; displayName: string; bio?: string; defaultPriceUsd?: string } }) {
    return this.req<{ agent: AgentView; ownerUserId: number; providerId: number | null }>("POST", "/internal/agents/register", b);
  }
  agents(type: "execution" | "strategy" | "aggregator") {
    return this.req<{ items: AgentView[] }>("GET", `/internal/agents?type=${type}`).then((r) => r.items);
  }
  agent(id = this.agentId!) {
    return this.req<AgentView>("GET", `/agents/${id}`);
  }
  secrets(id = this.agentId!) {
    return this.req<{ id: number; wallet: string | null; walletKey: `0x${string}` | null; encKey: `0x${string}` | null }>("GET", `/internal/agents/${id}/secrets`);
  }
  spend(amount: bigint, id = this.agentId!) {
    return this.req<AgentView>("POST", `/internal/agents/${id}/spend`, { amount: amount.toString() });
  }
  activity(a: { decision: "buy" | "skip" | "post" | "trade" | "route" | "error"; reason?: string; signalId?: string; purchaseId?: string; fill?: Record<string, unknown> }, id = this.agentId!) {
    return this.req<{ id: number }>("POST", `/agents/${id}/activity`, a);
  }
  recentActivity(id = this.agentId!) {
    return this.req<{ items: { decision: string; signalId: string | null; createdAt: string; reason: string | null }[] }>("GET", `/agents/${id}/activity`);
  }

  // provider path (same draft → prepare → confirm as humans)
  draft(rawText: string, parsed?: Record<string, unknown>) {
    return this.req<{ id: number }>("POST", "/drafts", { rawText, parsed, parser: "agent" });
  }
  prepare(draftId: number, signal: unknown) {
    return this.req<{ salt: string; commitHash: string; typedData: { domain: any; types: any; primaryType: string; message: Record<string, string> } }>("POST", `/drafts/${draftId}/prepare`, signal);
  }
  confirm(draftId: number, body: unknown) {
    return this.req<{ signalId: string; commitHash: string; status: string }>("POST", `/drafts/${draftId}/confirm`, body);
  }
  signalsBy(handle: string) {
    return this.req<{ items: SignalView[] }>("GET", `/signals?provider=${handle}&limit=100`).then((r) => r.items);
  }

  // subscriber path
  createPurchase(signalId: string) {
    return this.req<{ purchaseId: string; status: string; intent: { intentId: string; mandateTypedData: MandateTypedData; payee: `0x${string}` } }>("POST", "/purchases", { signalId, token: "USDT" });
  }
  submitPurchase(id: string, b: { mandateSig: string; txHash: string }) {
    return this.req<PurchaseView>("POST", `/purchases/${id}/submit`, b, { "idempotency-key": `agent:${id}:${b.txHash}` });
  }
  purchase(id: string) {
    return this.req<PurchaseView>("GET", `/purchases/${id}`);
  }
  key(id: string) {
    return this.req<{ wrappedKey: string; ciphertext: string; iv: string; signalId: string }>("GET", `/purchases/${id}/key`);
  }
}
