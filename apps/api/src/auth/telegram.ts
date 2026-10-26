import { bytesToHex, hmacSha256, timingSafeEqualHex } from "../lib/crypto.js";

export interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface InitData {
  user?: TelegramUser;
  authDate: number;
  queryId?: string;
  startParam?: string;
}

const MAX_AGE_S = 3600;

/**
 * Validates Telegram Mini App initData (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):
 * secret = HMAC_SHA256(key="WebAppData", msg=botToken); hash = HMAC_SHA256(secret, data_check_string).
 */
export function verifyInitData(raw: string, botToken: string, nowS = Math.floor(Date.now() / 1000)): InitData | null {
  const params = new URLSearchParams(raw);
  const hash = params.get("hash");
  if (!hash) return null;
  const pairs: string[] = [];
  for (const [k, v] of params.entries()) {
    if (k !== "hash") pairs.push(`${k}=${v}`);
  }
  pairs.sort();
  const secret = hmacSha256("WebAppData", botToken);
  const computed = bytesToHex(hmacSha256(secret, pairs.join("\n")));
  if (!timingSafeEqualHex(computed, hash.toLowerCase())) return null;
  const authDate = Number(params.get("auth_date") ?? 0);
  if (!authDate || nowS - authDate > MAX_AGE_S) return null;
  const userRaw = params.get("user");
  let user: TelegramUser | undefined;
  if (userRaw) {
    try {
      user = JSON.parse(userRaw) as TelegramUser;
    } catch {
      return null;
    }
  }
  return {
    user,
    authDate,
    queryId: params.get("query_id") ?? undefined,
    startParam: params.get("start_param") ?? undefined,
  };
}

/** Test/bot helper: builds a signed initData string. */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const pairs = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort();
  const secret = hmacSha256("WebAppData", botToken);
  const hash = bytesToHex(hmacSha256(secret, pairs.join("\n")));
  const p = new URLSearchParams(fields);
  p.set("hash", hash);
  return p.toString();
}
