/**
 * Response shapes of the public API (mirror apps/api/src/routes/schemas.ts). Used by the web app,
 * MCP server and SDKs so they don't depend on the API package.
 */

export interface ApiScore {
  period: string | null;
  n: number;
  wins: number;
  losses: number;
  voids: number;
  winRate: number;
  wilsonLb: number;
  expectancyR: number;
  alphaBtc: number;
  maxDd: number;
  followerPnl: number;
  /** 0–100; null while on probation */
  score: number | null;
  probation: boolean;
}

export type ProviderKind = "human" | "agent" | "aggregator" | "observed";

export interface ApiProvider {
  handle: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  address: string;
  erc8004Id: string | null;
  kind: ProviderKind | string;
  verified: boolean;
  isPractice: boolean;
  observed: boolean;
  channelTitle: string | null;
  /** The Telegram channel this provider proved they own or admin; null until verified. */
  channel: ApiVerifiedChannel | null;
  /** Handle of an established provider whose name this profile's channel closely resembles. */
  lookalikeOf: string | null;
  defaultPriceUsd: string;
  bondUsd: string;
  createdAt: string;
  score: ApiScore;
}

export interface ApiVerifiedChannel {
  title: string | null;
  /** Public @username without the @, or null for a private channel. */
  username: string | null;
  url: string | null;
  members: number | null;
  /** The provider's own role there, as Telegram reported it: creator (owner) or administrator. */
  role: "creator" | "administrator" | string | null;
  verifiedAt: string;
}

export interface ApiProviderDetail extends ApiProvider {
  scores: (ApiScore & { market: string })[];
}

export type ApiSignalStatus =
  | "COMMITTED"
  | "LIVE"
  | "TOUCH_PENDING"
  | "RESOLVED"
  | "SETTLED"
  | "REVEALED"
  | "UNREVEALED_LOSS"
  | "REFUNDED"
  | "VOID";

export interface ApiSignal {
  id: string;
  provider: { handle: string; displayName: string; kind: string } | null;
  commitHash: string;
  market: string;
  status: ApiSignalStatus | string;
  outcome: "WIN" | "LOSS" | "VOID" | null | string;
  rMultiple: number | null;
  revealed: boolean;
  side: "LONG" | "SHORT" | null;
  entry: string | null;
  takeProfit: string | null;
  stopLoss: string | null;
  isLimit: boolean | null;
  oraclePriceAtCommit: string | null;
  priceUsd: string;
  validUntil: string;
  committedAt: string;
  revealedAt: string | null;
  decidedAt: string | null;
  purchaseCount: number;
  upstream: { id: string; bps: number }[];
  tx: { commit: string | null; reveal: string | null; resolve: string | null };
}

export interface ApiSettlement {
  outcome: string;
  proofTx: string | null;
  settleTx: string | null;
  payoutUsd: string;
  refundsUsd: string;
  slashUsd: string;
  settledAt: string;
}

export interface ApiSignalDetail extends ApiSignal {
  upstreamTree: { id: string; bps: number; depth: number; signal: ApiSignal | null }[];
  settlement: ApiSettlement | null;
  paymentIds: string[];
}

export interface ApiPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ApiStats {
  signalsCommitted: number;
  signalsSettled: number;
  paymentsSettled: number;
  refundsPaid: string;
  volumeUsd: string;
  providers: number;
}

export interface ApiCandle {
  t: number;
  o: string;
  h: string;
  l: string;
  c: string;
  v: string;
}

export interface ApiContracts {
  chainId: number;
  deployed: boolean;
  addresses: Record<string, unknown>;
  abis: Record<string, unknown[]>;
}
