/**
 * Production smoke test: signs in with a throwaway wallet through the web app's /backend proxy
 * (same path the browser uses), then reads /auth/me with the session cookie.
 *   tsx scripts/prod-siwe-smoke.ts https://nundina-signals.vercel.app
 */
import { createSiweMessage } from "viem/siwe";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const site = (process.argv[2] ?? "https://nundina-signals.vercel.app").replace(/\/$/, "");
const chainId = Number(process.argv[3] ?? 133);
const account = privateKeyToAccount(generatePrivateKey());

const nonceRes = await fetch(`${site}/backend/auth/nonce`, { headers: { accept: "application/json" } });
const { nonce } = (await nonceRes.json()) as { nonce: string };
const cookies = (nonceRes.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");

const message = createSiweMessage({
  address: account.address,
  chainId,
  domain: new URL(site).host,
  nonce,
  uri: site,
  version: "1",
  statement: "Sign in to Nundina",
});
const signature = await account.signMessage({ message });
const verify = await fetch(`${site}/backend/auth/verify`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie: cookies },
  body: JSON.stringify({ message, signature }),
});
const session = (verify.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
console.log("verify", verify.status, JSON.stringify(await verify.json()).slice(0, 160));
const me = await fetch(`${site}/backend/auth/me`, { headers: { cookie: [cookies, session].filter(Boolean).join("; ") } });
console.log("me", me.status, JSON.stringify(await me.json()).slice(0, 160));
console.log("cookie flags", (verify.headers.getSetCookie?.() ?? []).map((c) => c.split(";").slice(1).join(";").trim()).join(" | "));
