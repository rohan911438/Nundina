/**
 * Seeds live demo signals on testnet through the production API, the same path a provider's
 * browser takes: SIWE sign-in → provider profile → ERC-8004 identity + practice registration →
 * draft → prepare → sign → confirm. Practice providers are free, so no bond or USDT is needed.
 *
 *   tsx scripts/demo-signals.ts <keyFile> [count=3] [site=https://nundina-signals.vercel.app]   (START=n resumes at plan n)
 *
 * The demo provider's key lives in <keyFile> (created on first run, never printed). Gas comes
 * from DEPLOYER_PRIVATE_KEY when the demo wallet runs low. Testnet (chain 133) only.
 */
import fs from "node:fs";
import { createPublicClient, createWalletClient, defineChain, formatEther, getAddress, http, parseEther, parseEventLogs, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { contractAddress, toPrice } from "@nundina/shared";
import { identityRegistryAbi, providerRegistryAbi } from "@nundina/shared/abis";

const [keyFile, countArg, siteArg] = process.argv.slice(2);
if (!keyFile) throw new Error("usage: demo-signals.ts <keyFile> [count] [site]");
const count = Number(countArg ?? 3);
const site = (siteArg ?? "https://nundina-signals.vercel.app").replace(/\/$/, "");
const CHAIN_ID = 133;
const rpc = process.env.HSK_TESTNET_RPC_URL;
if (!rpc) throw new Error("HSK_TESTNET_RPC_URL is not set");

const chain = defineChain({ id: CHAIN_ID, name: "HashKey Chain Testnet", nativeCurrency: { name: "HSK", symbol: "HSK", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
const pub = createPublicClient({ chain, transport: http(rpc) });

if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, JSON.stringify({ privateKey: generatePrivateKey() }), { mode: 0o600 });
const account = privateKeyToAccount(JSON.parse(fs.readFileSync(keyFile, "utf8")).privateKey as Hex);
const wallet = createWalletClient({ account, chain, transport: http(rpc) });
console.log("demo provider", account.address);

// ── gas
const MIN = parseEther("0.01");
const bal = await pub.getBalance({ address: account.address });
if (bal < MIN) {
  const funderKey = process.env.DEPLOYER_PRIVATE_KEY as Hex | undefined;
  if (!funderKey) throw new Error("demo wallet needs gas and DEPLOYER_PRIVATE_KEY is not set");
  const funder = createWalletClient({ account: privateKeyToAccount(funderKey), chain, transport: http(rpc) });
  const fb = await pub.getBalance({ address: funder.account.address });
  if (fb < parseEther("0.03")) throw new Error(`funder has only ${formatEther(fb)} HSK; top it up at https://faucet.hsk.xyz`);
  const h = await funder.sendTransaction({ to: account.address, value: parseEther("0.02") });
  await pub.waitForTransactionReceipt({ hash: h });
  console.log("funded 0.02 HSK", h);
}

// ── session
let cookie = "";
const keep = (r: Response) => {
  const set = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]);
  if (set.length) cookie = [cookie, ...set].filter(Boolean).join("; ");
};
async function call<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const r = await fetch(`${site}/backend${path}`, {
    method,
    headers: { accept: "application/json", ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  keep(r);
  return { status: r.status, body: (await r.json().catch(() => null)) as T };
}
const { body: n } = await call<{ nonce: string }>("GET", "/auth/nonce");
const message = createSiweMessage({ address: account.address, chainId: CHAIN_ID, domain: new URL(site).host, nonce: n.nonce, uri: site, version: "1", statement: "Sign in to Nundina" });
const v = await call("POST", "/auth/verify", { message, signature: await account.signMessage({ message }) });
if (v.status >= 300) throw new Error(`sign-in failed: ${JSON.stringify(v.body)}`);

// ── provider profile + on-chain registration
const registry = contractAddress(CHAIN_ID, "ProviderRegistry");
const identity = contractAddress(CHAIN_ID, "IdentityRegistry");
let mine = await call("GET", "/me/provider");
if (mine.status === 404) {
  const handle = `demo_${account.address.slice(2, 8).toLowerCase()}`;
  const r = await call("POST", "/providers/register", { handle, displayName: "Nundina Demo Desk", defaultPrice: "0", practice: true });
  if (r.status !== 201) throw new Error(`register failed: ${JSON.stringify(r.body)}`);
  console.log("profile", handle);
  mine = await call("GET", "/me/provider");
}
const onChain = await pub.readContract({ address: registry, abi: providerRegistryAbi, functionName: "isRegistered", args: [account.address] }).catch(() => false);
if (!onChain) {
  // the identity id is kept in the key file, so a failed registration doesn't mint a second one
  const saved = JSON.parse(fs.readFileSync(keyFile, "utf8"));
  let agentId = saved.agentId ? BigInt(saved.agentId) : null;
  if (agentId == null) {
    const uri = `${site}/api/agent-card/${mine.body.provider.handle}`;
    const h1 = await wallet.writeContract({ address: identity, abi: identityRegistryAbi, functionName: "register", args: [uri] });
    const rc = await pub.waitForTransactionReceipt({ hash: h1 });
    const [ev] = parseEventLogs({ abi: identityRegistryAbi, eventName: "Registered", logs: rc.logs });
    agentId = (ev!.args as { agentId: bigint }).agentId;
    fs.writeFileSync(keyFile, JSON.stringify({ ...saved, agentId: agentId.toString() }), { mode: 0o600 });
  }
  // a load-balanced RPC can lag the mint: retry the simulation until it sees the identity
  for (let i = 0; ; i++) {
    try {
      const h2 = await wallet.writeContract({ address: registry, abi: providerRegistryAbi, functionName: "register", args: [agentId, account.address, `0x${"0".repeat(64)}`, true] });
      await pub.waitForTransactionReceipt({ hash: h2 });
      break;
    } catch (e) {
      if (i >= 6) throw e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  console.log("registered on-chain, agentId", agentId.toString());
}

// ── signals at today's prices: alternate markets and sides, TP/SL around the last close
async function last(market: string) {
  const r = await call<{ candles: { c: string }[] }>("GET", `/prices?market=${encodeURIComponent(market)}`);
  const c = r.body?.candles?.at(-1)?.c;
  if (!c) throw new Error(`no price for ${market}`);
  return Number(c);
}
const plans = [
  { market: "BTC/USD", side: "LONG" as const, tp: 0.02, sl: 0.01, hours: 24 },
  { market: "HSK/USD", side: "LONG" as const, tp: 0.05, sl: 0.025, hours: 24 },
  { market: "BTC/USD", side: "SHORT" as const, tp: 0.02, sl: 0.01, hours: 12 },
  { market: "HSK/USD", side: "SHORT" as const, tp: 0.05, sl: 0.025, hours: 12 },
];
const fmt = (x: number) => (x >= 100 ? x.toFixed(1) : x.toFixed(4));

const start = Number(process.env.START ?? 0); // plan to begin with, to resume a partial run
for (let i = start; i < start + count; i++) {
  const p = plans[i % plans.length]!;
  const px = await last(p.market);
  const dir = p.side === "LONG" ? 1 : -1;
  const levels = { entry: fmt(px), takeProfit: fmt(px * (1 + dir * p.tp)), stopLoss: fmt(px * (1 - dir * p.sl)) };
  const block = await pub.getBlock();
  const signal = {
    market: p.market,
    side: p.side,
    entry: toPrice(levels.entry).toString(),
    takeProfit: toPrice(levels.takeProfit).toString(),
    stopLoss: toPrice(levels.stopLoss).toString(),
    validUntil: String(Math.max(Number(block.timestamp), Math.floor(Date.now() / 1000)) + p.hours * 3600),
    pricePerSub: "0",
    upstream: [],
    upstreamBps: [],
  };
  const d = await call("POST", "/drafts", { rawText: `${p.market} ${p.side} entry ${levels.entry} TP ${levels.takeProfit} SL ${levels.stopLoss}`, parser: "manual" });
  const prep = await call("POST", `/drafts/${d.body.id}/prepare`, signal);
  if (prep.status !== 200) throw new Error(`prepare failed: ${JSON.stringify(prep.body)}`);
  const td = prep.body.typedData;
  const providerSig = await account.signTypedData({
    domain: td.domain,
    types: td.types,
    primaryType: td.primaryType,
    message: { ...td.message, validUntil: BigInt(td.message.validUntil), pricePerSub: BigInt(td.message.pricePerSub), nonce: BigInt(td.message.nonce), deadline: BigInt(td.message.deadline) },
  });
  const ok = await call("POST", `/drafts/${d.body.id}/confirm`, { signal, commitAuth: td.message, providerSig });
  if (ok.status !== 201) throw new Error(`confirm failed: ${JSON.stringify(ok.body)}`);
  console.log(`#${ok.body.signalId} ${p.market} ${p.side} entry ${levels.entry} TP ${levels.takeProfit} SL ${levels.stopLoss} ${p.hours}h  ${site}/s/${ok.body.signalId}`);
}
console.log("profile", `${site}/p/${(await call("GET", "/me/provider")).body.provider.handle}`, getAddress(account.address));
