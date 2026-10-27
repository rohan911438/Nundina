"use client";

import type { ApiSignal } from "@nundina/shared";
import { ApiError } from "./api";
import { config } from "./config";

/**
 * Authenticated calls from the browser. The API session is an httpOnly cookie set by
 * `/auth/verify`; inside Telegram every call also carries the Mini App `initData`.
 */

let tgInitData: string | null = null;
export function setTelegramInitData(v: string | null) {
  tgInitData = v;
}
export const telegramInitData = () => tgInitData;

export async function authed<T>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  const res = await fetch(`${config.apiUrl}${path}`, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    credentials: "include",
    headers: {
      accept: "application/json",
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(tgInitData ? { "x-telegram-init-data": tgInitData } : {}),
      ...init.headers,
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const json = (await res.json().catch(() => null)) as (T & { error?: { code: string; message: string } }) | null;
  if (!res.ok) throw new ApiError(res.status, json?.error?.code ?? "http_error", json?.error?.message ?? res.statusText);
  return json as T;
}

export interface Me {
  userId: number | null;
  wallet: string | null;
}

export interface PurchaseView {
  id: string;
  signalId: string;
  status: string;
  amount: string;
  amountUsd: string;
  token: string;
  rail: string;
  paymentId: string | null;
  txHash: string | null;
  outcomeClass: string | null;
  receiptHash: string | null;
  creditedTx: string | null;
  explorerUrl: string | null;
  recoveryTx: string | null;
  rejectReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MandateTypedData {
  domain: { name: string; version: string; chainId: number };
  types: Record<string, { name: string; type: string }[]>;
  primaryType: "Mandate";
  message: { payer: string; payee: string; token: string; amount: string; chainId: string; reference: string; requiredCaps: string[] | string; nonce: string; deadline: string };
}

export interface Intent {
  intentId: string;
  mandateTypedData: MandateTypedData;
  payee: string;
  reference: string;
}

export interface SubscriberView {
  wallet: string | null;
  hasEncryptionKey: boolean;
  totals: { spentUsd: string; refundedUsd: string; purchases: number };
  purchases: (PurchaseView & { signal: ApiSignal })[];
}

export interface AgentView {
  id: number;
  name: string;
  type: string;
  wallet: string | null;
  paused: boolean;
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
  createdAt: string;
}

export interface AgentActivity {
  id: number;
  decision: "buy" | "skip" | "post" | "trade" | "error";
  reason: string | null;
  signalId: string | null;
  purchaseId: string | null;
  fill: unknown;
  createdAt: string;
}

export interface DraftView {
  id: number;
  status: string;
  rawText: string;
  parsed: { market?: string; side?: "LONG" | "SHORT"; entry?: string; takeProfit?: string; stopLoss?: string; validHours?: number; notes?: string[] } | null;
  parser: string;
  signalId: string | null;
  provider: { handle: string; address: string; defaultPrice: string; practice: boolean };
}

export interface MyProvider {
  provider: {
    handle: string;
    displayName: string | null;
    address: string;
    payoutAddr: string;
    linked: boolean;
    channelId: number | null;
    isPractice?: boolean;
    practice?: boolean;
    defaultPriceUsd?: string;
    badges?: string[];
    agentId?: string | null;
    score?: { score: number | null; n: number; probation: boolean };
  };
  counts: { live: number; sales: number; total: number };
  bond: { totalUsd: string; lockedUsd: string };
  settings: ProviderSettings & { payIfWorksAllowed: boolean };
  earnings: { grossUsd: string; feesUsd: string; slashedUsd: string; netUsd: string };
  payouts: { signalId: string; outcome: string; payoutUsd: string; slashUsd: string; settleTx: string | null; settledAt: string }[];
  recentSignals: ApiSignal[];
  drafts: { id: number; rawText: string; parsed: DraftView["parsed"]; status: string; createdAt: string }[];
}

export interface ProviderSettings {
  defaultPriceUsd: string;
  defaultValidityHours: number;
  practice: boolean;
  payIfWorks: boolean;
}

export const me = {
  session: () => authed<Me>("/auth/me"),
  nonce: () => authed<{ nonce: string }>("/auth/nonce"),
  verify: (message: string, signature: string) => authed<Me>("/auth/verify", { body: { message, signature } }),
  logout: () => authed<{ ok: true }>("/auth/logout", { body: {} }),
  setEncryptionKey: (publicKey: string) => authed<{ ok: true }>("/me/encryption-key", { body: { publicKey } }),
  subscriber: () => authed<SubscriberView>("/me/subscriber"),
  provider: () => authed<MyProvider>("/me/provider"),
};

export const purchasesApi = {
  create: (signalId: string, token: "USDT" | "USDC_E") =>
    authed<{ purchaseId: string; status: string; intent: Intent }>("/purchases", { body: { signalId, token } }),
  submit: (id: string, mandateSig: string, txHash: string) =>
    authed<PurchaseView>(`/purchases/${id}/submit`, { body: { mandateSig, txHash }, headers: { "idempotency-key": `${id}:${txHash}` } }),
  authorize: (id: string, authorization: Record<string, string>, signature: string) =>
    authed<PurchaseView>(`/purchases/${id}/authorize`, { body: { authorization, signature } }),
  get: (id: string) => authed<PurchaseView>(`/purchases/${id}`),
  key: (id: string) => authed<{ purchaseId: string; signalId: string; wrappedKey: string; ciphertext: string; iv: string }>(`/purchases/${id}/key`),
};

export const draftsApi = {
  get: (id: string) => authed<DraftView>(`/drafts/${id}`),
  prepare: (id: string, signal: Record<string, unknown>) =>
    authed<{ salt: string; commitHash: string; typedData: { domain: Record<string, unknown>; types: Record<string, { name: string; type: string }[]>; primaryType: string; message: Record<string, string> } }>(
      `/drafts/${id}/prepare`,
      { body: signal },
    ),
  confirm: (id: string, body: unknown) => authed<{ signalId: string; commitHash: string; txHash?: string; status: string }>(`/drafts/${id}/confirm`, { body }),
};

export const providerApi = {
  register: (body: { handle: string; displayName?: string; defaultPrice?: string; practice?: boolean; kind?: "human" | "agent" | "aggregator"; telegramHandle?: string }) =>
    authed<{
      provider: MyProvider["provider"];
      tx: { agentUri?: string; steps: { label: string; to: string; data?: string; abi?: string; args?: { payout: string; tgHandleHash: string; practice: boolean } }[] };
    }>("/providers/register", { body }),
  settings: (b: { defaultPrice?: string; defaultValidityHours?: number; payIfWorks?: boolean; practice?: boolean }) =>
    authed<ProviderSettings>("/me/provider", { method: "PATCH", body: b }),
  linkCode: () => authed<{ code: string; expiresInS: number }>("/providers/link-telegram/code", { body: {} }),
};

export const agentsApi = {
  list: () => authed<{ items: AgentView[] }>("/agents"),
  create: (name: string, policy: Partial<AgentView["policy"]>) => authed<{ agent: AgentView; apiKey: string }>("/agents", { body: { name, policy: cleanPolicy(policy) } }),
  policy: (id: number, policy: Partial<AgentView["policy"]>) => authed<AgentView>(`/agents/${id}/policy`, { method: "PATCH", body: cleanPolicy(policy) }),
  pause: (id: number, paused: boolean) => authed<AgentView>(`/agents/${id}/pause`, { body: { paused } }),
  activity: (id: number) => authed<{ items: AgentActivity[] }>(`/agents/${id}/activity`),
};

function cleanPolicy(p: Partial<AgentView["policy"]>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) if (v !== null && v !== undefined && v !== "") out[k] = v;
  return out;
}
