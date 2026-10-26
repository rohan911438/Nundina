import { createApp } from "../src/app.js";
import { db } from "../src/db/client.js";
import { providers, users } from "../src/db/schema.js";

export const INTERNAL = { "x-internal-secret": "test-internal-secret-0123456789" };
export const app = createApp();

export async function getJson(path: string, headers: Record<string, string> = {}) {
  const res = await app.request(path, { headers });
  return { status: res.status, body: (await res.json()) as any };
}

export async function postJson(path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any, res };
}

let n = 0;
/** Inserts a user + provider; returns both ids. */
export async function makeProvider(opts: { address: string; handle?: string; practice?: boolean }) {
  n++;
  const [u] = await db().insert(users).values({ wallet: opts.address.toLowerCase() }).returning();
  const [p] = await db()
    .insert(providers)
    .values({
      userId: u!.id,
      handle: opts.handle ?? `prov_${Date.now()}_${n}`,
      displayName: "Test Provider",
      address: opts.address.toLowerCase(),
      payoutAddr: opts.address.toLowerCase(),
      isPractice: opts.practice ?? false,
    })
    .returning();
  return { userId: u!.id, providerId: p!.id, handle: p!.handle };
}
