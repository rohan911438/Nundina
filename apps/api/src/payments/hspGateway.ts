import { createHash, createHmac, createPrivateKey, randomBytes, sign, timingSafeEqual, type KeyObject } from "node:crypto";

/**
 * HashKey Merchant gateway client (https://hashkey-merchant.github.io, docs/en/*.md):
 *   - every `/api/v1/merchant/*` call is HMAC-SHA256 signed (X-App-Key, X-Signature, X-Timestamp, X-Nonce)
 *   - `cart_mandate.merchant_authorization` is an ES256K JWT whose `cart_hash` is
 *     SHA-256(Canonical JSON(cart_mandate.contents))
 *   - webhooks carry `X-Signature: t=<unix>,v1=<hex HMAC(app_secret, t + "." + rawBody)>`
 */

export interface GatewayConfig {
  baseUrl: string;
  appKey: string;
  appSecret: string;
  merchantKey: KeyObject;
  merchantName: string;
  fetch?: typeof fetch;
}

/** RFC 8785-style canonical JSON as the docs specify it: keys sorted recursively, compact. */
export function canonicalJson(v: unknown): string {
  const sort = (x: unknown): unknown => {
    if (x === null || typeof x !== "object") return x;
    if (Array.isArray(x)) return x.map(sort);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(x as object).sort()) out[k] = sort((x as Record<string, unknown>)[k]);
    return out;
  };
  return JSON.stringify(sort(v));
}

export const sha256Hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** `METHOD\nPATH\nQUERY\nbodyHash\ntimestamp\nnonce`, HMAC-SHA256 hex with app_secret. */
export function requestSignature(appSecret: string, p: { method: string; path: string; query: string; body?: string; timestamp: string; nonce: string }) {
  const bodyHash = p.body ? sha256Hex(p.body) : "";
  const message = [p.method.toUpperCase(), p.path, p.query, bodyHash, p.timestamp, p.nonce].join("\n");
  return createHmac("sha256", appSecret).update(message, "utf8").digest("hex");
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** ES256K compact JWT (r||s signature) over the Cart Mandate contents. */
export function merchantAuthorization(key: KeyObject, merchantName: string, contents: unknown, now = Math.floor(Date.now() / 1000)) {
  const header = { alg: "ES256K", typ: "JWT" };
  const claims = {
    iss: merchantName,
    sub: merchantName,
    aud: "HashkeyMerchant",
    iat: now,
    exp: now + 3600,
    jti: `JWT-${now}-${randomBytes(6).toString("hex")}`,
    cart_hash: sha256Hex(canonicalJson(contents)),
  };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const sig = sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" });
  return `${input}.${b64url(sig)}`;
}

export function loadMerchantKey(pem: string): KeyObject {
  const k = createPrivateKey(pem);
  if (k.asymmetricKeyType !== "ec" || k.asymmetricKeyDetails?.namedCurve !== "secp256k1") throw new Error("merchant key must be secp256k1 (ES256K)");
  return k;
}

/** Verifies a webhook `X-Signature` header; ±300 s timestamp tolerance, constant-time compare. */
export function verifyWebhook(appSecret: string, header: string | undefined, rawBody: string, now = Math.floor(Date.now() / 1000)): { ok: true } | { ok: false; reason: string } {
  if (!header) return { ok: false, reason: "missing X-Signature" };
  let t = NaN;
  let v1 = "";
  for (const part of header.split(",")) {
    const [k, v] = part.trim().split("=", 2);
    if (k === "t") t = Number(v);
    if (k === "v1") v1 = v ?? "";
  }
  if (!Number.isFinite(t) || !v1) return { ok: false, reason: "malformed X-Signature" };
  if (Math.abs(now - t) > 300) return { ok: false, reason: "timestamp out of tolerance" };
  const expected = createHmac("sha256", appSecret).update(`${t}.${rawBody}`, "utf8").digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "signature mismatch" };
  return { ok: true };
}

export interface GatewayEnvelope<T> {
  code: number;
  msg: string;
  data?: T;
}

export class GatewayError extends Error {
  constructor(
    public code: number,
    message: string,
    public httpStatus: number,
  ) {
    super(message);
  }
}

/** Payment record (`PaymentItemResponse`), only the fields we use. */
export interface GatewayPayment {
  content_id?: string;
  payment_request_id?: string;
  flow_id?: string;
  status: string;
  status_reason?: string;
  tx_signature?: string;
  payer_address?: string;
  to_pay_address?: string;
  token_address?: string;
  order_amount?: string;
  pay_amount?: string;
}

export class GatewayClient {
  private readonly f: typeof fetch;
  constructor(readonly cfg: GatewayConfig) {
    this.f = cfg.fetch ?? ((...a) => fetch(...a));
  }

  async call<T>(method: "GET" | "POST", path: string, opts: { query?: Record<string, string>; body?: unknown } = {}): Promise<T> {
    const fullPath = `/api/v1${path}`;
    const query = opts.query ? new URLSearchParams(opts.query).toString() : "";
    const body = opts.body === undefined ? undefined : canonicalJson(opts.body);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(16).toString("hex");
    const signature = requestSignature(this.cfg.appSecret, { method, path: fullPath, query, body, timestamp, nonce });
    const res = await this.f(`${this.cfg.baseUrl.replace(/\/$/, "")}${fullPath}${query ? `?${query}` : ""}`, {
      method,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        "x-app-key": this.cfg.appKey,
        "x-signature": signature,
        "x-timestamp": timestamp,
        "x-nonce": nonce,
      },
      body,
    });
    const json = (await res.json().catch(() => null)) as GatewayEnvelope<T> | null;
    if (!json) throw new GatewayError(-1, `gateway ${method} ${path}: HTTP ${res.status}, non-JSON body`, res.status);
    if (json.code !== 0) throw new GatewayError(json.code, `gateway ${method} ${path}: ${json.code} ${json.msg}`, res.status);
    return json.data as T;
  }

  /** One-time order: `POST /merchant/orders` with a signed Cart Mandate. */
  createOrder(contents: Record<string, unknown>, redirectUrl?: string) {
    const merchant_authorization = merchantAuthorization(this.cfg.merchantKey, this.cfg.merchantName, contents);
    return this.call<{ payment_request_id: string; payment_url: string; multi_pay: boolean }>("POST", "/merchant/orders", {
      body: { cart_mandate: { contents, merchant_authorization }, ...(redirectUrl ? { redirect_url: redirectUrl } : {}) },
    });
  }

  /** `GET /merchant/payments?payment_request_id=…` (single record). */
  payment(paymentRequestId: string) {
    return this.call<GatewayPayment>("GET", "/merchant/payments", { query: { payment_request_id: paymentRequestId } });
  }
}
