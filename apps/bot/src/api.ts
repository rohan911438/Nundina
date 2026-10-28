/** Typed client for apps/api. Every call carries the internal secret; user calls also act as a user. */

export interface PublicSignal {
  id: string;
  provider: { handle: string; displayName: string; kind: string } | null;
  market: string;
  status: string;
  outcome: string | null;
  rMultiple: number | null;
  revealed: boolean;
  side: "LONG" | "SHORT" | null;
  priceUsd: string;
  validUntil: string;
  committedAt: string;
  decidedAt: string | null;
  purchaseCount: number;
  tx: { commit: string | null; reveal: string | null; resolve: string | null };
}

export interface ProviderCard {
  id: number;
  handle: string;
  displayName: string;
  channelId: number | null;
  channelTitle: string | null;
  telegramId: number | null;
}

export interface SignalNotify {
  signal: PublicSignal & { pricePerSub: string };
  provider: ProviderCard;
  post: { chatId: number; messageId: number } | null;
  cardMessageId: number | null;
  buyers: { purchaseId: string; status: string; telegramId: number }[];
  settlement: { outcome: string; payout: string; refundsTotal: string; slashTotal: string; settleTx: string | null } | null;
}

export interface TelegramUser {
  userId: number;
  wallet: string | null;
  hasEncryptionKey: boolean;
  provider: { handle: string; channelId: number | null } | null;
}

/** What the bot reads from Telegram about a channel; the API decides ownership from `admins`. */
export interface ChannelFacts {
  channelId: number;
  title: string;
  username?: string;
  members?: number;
  admins: { id: number; status: "creator" | "administrator" }[];
}

export interface ChannelVerified {
  provider: { handle: string; displayName: string };
  role: "creator" | "administrator";
  lookalikeOf: string | null;
  telegramId: number;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export class Api {
  constructor(
    private readonly baseUrl: string,
    private readonly secret: string,
    private readonly fetchImpl: Fetch = (u, i) => fetch(u, i),
  ) {}

  async request<T>(method: string, path: string, opts: { body?: unknown; asUser?: number } = {}): Promise<T> {
    const headers: Record<string, string> = { "x-internal-secret": this.secret };
    if (opts.asUser) headers["x-act-as-user"] = String(opts.asUser);
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) throw new ApiError(res.status, json?.error?.code ?? "http_error", json?.error?.message ?? res.statusText);
    return json as T;
  }

  /** Same as `request` but 404 → null. */
  async maybe<T>(method: string, path: string, opts: { body?: unknown; asUser?: number } = {}): Promise<T | null> {
    try {
      return await this.request<T>(method, path, opts);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  }

  user = (telegramId: number, username?: string) => this.request<TelegramUser>("POST", "/internal/telegram/users", { body: { telegramId, username } });
  providerForChannel = (chatId: number) => this.maybe<ProviderCard>("GET", `/internal/telegram/channels/${chatId}`);
  draftForPost = (chatId: number, messageId: number) =>
    this.maybe<{ draftId: number; status: string; signalId: string | null }>("GET", `/internal/telegram/posts/${chatId}/${messageId}`);
  createDraft = (body: { providerHandle: string; rawText: string; parsed: unknown; parser: "rules" | "llm"; sourceChatId: number; sourceMessageId: number }) =>
    this.request<{ id: number; status: string }>("POST", "/drafts", { body });
  ignoreDraft = (id: number) => this.request<{ draftId: number }>("POST", `/internal/telegram/drafts/${id}/ignore`);
  linkCode = (userId: number) => this.request<{ code: string; expiresInS: number }>("POST", "/providers/link-telegram/code", { asUser: userId });
  linkChannel = (code: string, facts: ChannelFacts) => this.request<ChannelVerified>("POST", "/providers/link-telegram", { body: { code, ...facts } });
  /** The bot was made admin by `telegramId`; links the channel if that account owns or admins it. */
  verifyChannel = (telegramId: number, facts: ChannelFacts) =>
    this.request<ChannelVerified>("POST", "/internal/telegram/channels/verify", { body: { telegramId, ...facts } });
  unverifyChannel = (chatId: number) =>
    this.maybe<{ handle: string; title: string | null; telegramId: number | null }>("POST", `/internal/telegram/channels/${chatId}/unverify`);
  linkedChannels = () =>
    this.request<{ items: { channelId: number; providerId: number; handle: string; telegramId: number | null }[] }>("GET", "/internal/telegram/channels");
  redeemAccountLink = (token: string, telegramId: number, username?: string) =>
    this.request<{ userId: number; wallet: string | null }>("POST", "/internal/telegram/account-links/redeem", { body: { token, telegramId, username } });
  startAccountLink = (telegramId: number, username?: string) =>
    this.request<{ token: string; expiresInS: number }>("POST", "/internal/telegram/account-links", { body: { telegramId, username } });
  signalNotify = (id: string) => this.maybe<SignalNotify>("GET", `/internal/telegram/signals/${id}`);
  saveCard = (id: string, messageId: number) => this.request("POST", `/internal/telegram/signals/${id}/card`, { body: { messageId } });
  purchaseNotify = (id: string) =>
    this.maybe<{ purchaseId: string; status: string; telegramId: number | null; signal: PublicSignal | null }>("GET", `/internal/telegram/purchases/${id}`);
  signal = (id: string) => this.maybe<PublicSignal>("GET", `/signals/${id}`);
  liveSignals = () => this.request<{ items: PublicSignal[] }>("GET", "/signals?status=COMMITTED,REVEALED,TOUCH_PENDING&limit=10");
  mySubscriber = (userId: number) => this.request<{ purchases: { id: string; status: string; signal: PublicSignal }[] }>("GET", "/me/subscriber", { asUser: userId });
  myProvider = (userId: number) => this.maybe<{ bond: { totalUsd: string; lockedUsd: string } }>("GET", "/me/provider", { asUser: userId });
  myAgent = (userId: number) => this.maybe<{ status: string; spentTodayUsd: string; dailyCapUsd: string }>("GET", "/me/agent", { asUser: userId });
}
