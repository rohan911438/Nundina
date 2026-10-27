import { z } from "zod";
import { createWalletClient, erc20Abi, getAddress, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { decryptSignalBody, fromPrice, fromUnits, isEncryptionPublicKey, marketById, toUnits, unwrapKey } from "@nundina/shared";
import { env } from "../env.js";
import { chain, pub, rpcUrl, txUrl } from "../chain.js";
import { Nundina } from "../nundina.js";
import { NOT_ADVICE, fail, guarded, ok, type Ctx } from "./common.js";

export const buySignalInput = {
  id: z.string().regex(/^\d+$/).describe("Signal id (must be live)"),
  maxPrice: z.string().regex(/^\d+(\.\d{1,6})?$/).describe("Most you will pay, in USD (e.g. \"0.5\"). Refused if the signal costs more."),
  token: z.enum(["USDT", "USDC_E"]).default("USDT"),
  encryptionPublicKey: z.string().optional().describe("Your secp256k1 public key (hex); the signal key is wrapped to it. Needed once per account."),
  purchaseId: z.string().uuid().optional().describe("Step 2: the purchase id returned by step 1"),
  mandateSig: z.string().regex(/^0x[0-9a-fA-F]+$/).optional().describe("Step 2: your EIP-712 signature of the returned HSP mandate"),
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional().describe("Step 2: your ERC-20 transfer of the amount to the mandate's payee (e.g. via @hsp/mcp hsp_pay)"),
};

export const buySignalOutput = {
  mode: z.enum(["delegated", "custodial-demo"]),
  step: z.string(),
  purchaseId: z.string(),
  status: z.string(),
  priceUsd: z.string(),
  next: z.string().optional(),
  mandate: z.unknown().optional(),
  payee: z.string().optional(),
  hspPaymentId: z.string().nullable().optional(),
  delivery: z.object({ wrappedKey: z.string(), ciphertext: z.string(), iv: z.string() }).optional(),
  plaintext: z.unknown().optional(),
  explorer: z.string().nullable().optional(),
  note: z.string(),
};

export const buySignalMeta = (custodial: boolean) => ({
  title: "Buy a signal (spends money)",
  description: `SPENDS MONEY: pays the signal's price (USDT or USDC.e) through HSP into the PerformanceEscrow; refunded if the signal loses. Refuses if the price is above maxPrice. Delegated (default), two calls: (1) call with id + maxPrice → returns an HSP mandate to sign and the escrow to pay; (2) pay it in your own environment (e.g. @hsp/mcp hsp_pay), then call again with purchaseId, mandateSig, txHash → returns the encrypted key + ciphertext once unlocked (decrypt with your own key: ECIES-unwrap, then AES-256-GCM). Requires an agent API key (Bearer nk_…) whose wallet pays.${custodial ? " CUSTODIAL DEMO MODE is on (testnet only): calls without an API key are paid from a capped demo wallet and return the plaintext." : ""} ${NOT_ADVICE}`,
});

const KEYED = new Set(["KEY_SENT", "SETTLED_WIN", "REFUNDED"]);
const FAILED = new Set(["REJECTED", "FAILED_RETRYABLE", "FAILED"]);

async function waitKey(api: Nundina, purchaseId: string, ms = 60_000) {
  const until = Date.now() + ms;
  let p = await api.get<any>(`/purchases/${purchaseId}`);
  while (!KEYED.has(p.status) && !FAILED.has(p.status) && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 1500));
    p = await api.get<any>(`/purchases/${purchaseId}`);
  }
  return p;
}

type Body = { side: number; entry: string; takeProfit: string; stopLoss: string; market: string; validUntil: string };
const plain = (b: Body) => ({
  market: marketById(b.market)?.label ?? b.market,
  side: b.side === 0 ? "LONG" : "SHORT",
  entry: fromPrice(BigInt(b.entry)),
  takeProfit: fromPrice(BigInt(b.takeProfit)),
  stopLoss: fromPrice(BigInt(b.stopLoss)),
  validUntil: new Date(Number(b.validUntil) * 1000).toISOString(),
});

/** Demo agent the custodial mode pays from (registered once, scoped caps). */
let demo: { id: number; api: Nundina; internal: Nundina; encKey: string; account: ReturnType<typeof privateKeyToAccount>; wallet: ReturnType<typeof createWalletClient> } | undefined;
async function demoAgent() {
  if (demo) return demo;
  const e = env();
  const acct = privateKeyToAccount(e.MCP_DEMO_PRIVATE_KEY as Hex);
  const internal = new Nundina(undefined, { "x-internal-secret": e.INTERNAL_SECRET! });
  const r = await internal.post<{ agent: { id: number } }>("/internal/agents/register", { name: "mcp-demo", type: "mcp", wallet: acct.address });
  const secrets = await internal.get<{ encKey: string }>(`/internal/agents/${r.agent.id}/secrets`);
  const api = new Nundina(undefined, { "x-internal-secret": e.INTERNAL_SECRET!, "x-act-as-agent": String(r.agent.id) });
  demo = { id: r.agent.id, api, internal, encKey: secrets.encKey, account: acct, wallet: createWalletClient({ account: acct, chain: chain(), transport: http(rpcUrl()) }) };
  return demo;
}

export function buySignal(ctx: Ctx) {
  return (a: z.infer<z.ZodObject<typeof buySignalInput>>) =>
    guarded(async () => {
      const e = env();
      const custodial = !ctx.api.apiKey && e.MCP_CUSTODIAL && e.CHAIN_ID !== 177 && Boolean(e.MCP_DEMO_PRIVATE_KEY && e.INTERNAL_SECRET);
      if (!ctx.api.apiKey && !custodial) return fail("auth_required", "buy_signal needs an agent API key (Authorization: Bearer nk_…). Create one in /dashboard/agents.");

      const s = await ctx.anon.get<any>(`/signals/${a.id}`);
      const price = toUnits(s.priceUsd);
      if (price > toUnits(a.maxPrice)) return fail("over_max_price", `Signal #${a.id} costs ${s.priceUsd} USD, above your maxPrice ${a.maxPrice}. Nothing was spent.`, { priceUsd: s.priceUsd });

      if (custodial) {
        const d = await demoAgent();
        const spent = toUnits((await d.api.get<any>(`/agents/${d.id}`)).spentTodayUsd);
        if (price > e.MCP_DEMO_MAX_PER_SIGNAL_UNITS) return fail("spend_guard", `Demo wallet per-signal cap is ${fromUnits(e.MCP_DEMO_MAX_PER_SIGNAL_UNITS)} USD`);
        if (spent + price > e.MCP_DEMO_DAILY_UNITS) return fail("spend_guard", `Demo wallet daily cap of ${fromUnits(e.MCP_DEMO_DAILY_UNITS)} USD reached`);
        const created = await d.api.post<any>("/purchases", { signalId: a.id, token: a.token });
        const td = created.intent.mandateTypedData;
        if (getAddress(td.message.payee) !== getAddress(created.intent.payee)) return fail("spend_guard", "Mandate payee is not the escrow");
        const acct = d.account;
        const mandateSig = await acct.signTypedData({
          domain: { ...td.domain, chainId: Number(td.domain.chainId) },
          types: td.types,
          primaryType: "Mandate",
          message: { ...td.message, amount: BigInt(td.message.amount), chainId: BigInt(td.message.chainId), deadline: BigInt(td.message.deadline) },
        });
        const txHash = await d.wallet.writeContract({ account: acct, chain: chain(), address: getAddress(td.message.token), abi: erc20Abi, functionName: "transfer", args: [getAddress(td.message.payee), BigInt(td.message.amount)] });
        await pub().waitForTransactionReceipt({ hash: txHash });
        await d.api.post(`/purchases/${created.purchaseId}/submit`, { mandateSig, txHash }, { "idempotency-key": `mcp:${created.purchaseId}` });
        await d.internal.post(`/internal/agents/${d.id}/spend`, { amount: price.toString() });
        const p = await waitKey(d.api, created.purchaseId);
        if (!KEYED.has(p.status)) return fail("payment_failed", `Purchase ended ${p.status}`, { purchaseId: created.purchaseId });
        const k = await d.api.get<any>(`/purchases/${created.purchaseId}/key`);
        const body = decryptSignalBody<Body>(unwrapKey(d.encKey, k.wrappedKey), k.ciphertext, k.iv);
        return ok({ mode: "custodial-demo", step: "unlocked", purchaseId: created.purchaseId, status: p.status, priceUsd: s.priceUsd, hspPaymentId: p.paymentId, plaintext: plain(body), explorer: txUrl(txHash), note: `Paid from the server's capped demo wallet (testnet only). ${NOT_ADVICE}` });
      }

      // delegated
      if (a.encryptionPublicKey) {
        if (!isEncryptionPublicKey(a.encryptionPublicKey)) return fail("bad_key", "encryptionPublicKey is not a secp256k1 public key");
        await ctx.api.post("/me/encryption-key", { publicKey: a.encryptionPublicKey });
      }
      if (!a.purchaseId || !a.mandateSig || !a.txHash) {
        const created = await ctx.api.post<any>("/purchases", { signalId: a.id, token: a.token });
        return ok({
          mode: "delegated",
          step: "pay",
          purchaseId: created.purchaseId,
          status: created.status,
          priceUsd: s.priceUsd,
          mandate: created.intent.mandateTypedData,
          payee: created.intent.payee,
          next: `Sign \`mandate\` (EIP-712) with your payer wallet, transfer ${fromUnits(BigInt(created.intent.mandateTypedData.message.amount))} of ${created.intent.mandateTypedData.message.token} to ${created.intent.payee} (the escrow), then call buy_signal again with purchaseId, mandateSig and txHash.`,
          note: `Nothing has been spent yet. ${NOT_ADVICE}`,
        });
      }
      const sub = await ctx.api.post<any>(`/purchases/${a.purchaseId}/submit`, { mandateSig: a.mandateSig, txHash: a.txHash }, { "idempotency-key": `mcp:${a.purchaseId}:${a.txHash}` });
      const p = KEYED.has(sub.status) ? sub : await waitKey(ctx.api, a.purchaseId);
      if (!KEYED.has(p.status)) {
        return ok({ mode: "delegated", step: FAILED.has(p.status) ? "failed" : "verifying", purchaseId: a.purchaseId, status: p.status, priceUsd: s.priceUsd, hspPaymentId: p.paymentId ?? null, next: FAILED.has(p.status) ? `Payment ${p.status}: ${p.rejectReason ?? ""}` : "HSP is still verifying; call get_purchase in a few seconds.", explorer: txUrl(a.txHash), note: NOT_ADVICE });
      }
      const k = await ctx.api.get<any>(`/purchases/${a.purchaseId}/key`);
      return ok({
        mode: "delegated",
        step: "unlocked",
        purchaseId: a.purchaseId,
        status: p.status,
        priceUsd: s.priceUsd,
        hspPaymentId: p.paymentId ?? null,
        delivery: { wrappedKey: k.wrappedKey, ciphertext: k.ciphertext, iv: k.iv },
        explorer: txUrl(a.txHash),
        next: "ECIES-unwrap wrappedKey with your encryption private key, then AES-256-GCM decrypt ciphertext with iv; the plaintext is the signal JSON (prices in 8 decimals).",
        note: NOT_ADVICE,
      });
    });
}
