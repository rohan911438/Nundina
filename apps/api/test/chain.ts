/**
 * Local chain for integration tests: fresh anvil on a random port + `forge script Deploy` with the
 * repo's local deployer key, so contracts land at the addresses in packages/shared/src/addresses.json.
 */
import { execFile, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  http,
  parseEther,
  parseEventLogs,
  type Hex,
  type PrivateKeyAccount,
} from "viem";
import { contractAddress, localChain, paymentToken, toPrice } from "@nundina/shared";
import { erc20Abi, identityRegistryAbi, providerRegistryAbi } from "@nundina/shared/abis";
import { resetEnv } from "../src/env.js";
import { resetClients } from "../src/chain/clients.js";
import { INTERNAL, postJson } from "./helpers.js";
import { sql as rawSql } from "../src/db/client.js";

/** A fresh chain restarts signal ids at 1: drop rows that came from a previous chain. */
async function clearChainRows() {
  await rawSql()`delete from key_deliveries`;
  await rawSql()`delete from agent_actions`;
  await rawSql()`delete from purchases`;
  await rawSql()`delete from rail_payments`;
  await rawSql()`delete from settlements where signal_id in (select id from signals where source = 'chain')`;
  await rawSql()`delete from signals where source = 'chain'`;
  await rawSql()`delete from signal_drafts`;
  await rawSql()`delete from relayed_txs`;
}

export const ROOT = join(import.meta.dirname, "..", "..", "..");
const bin = (n: string) => join(homedir(), ".foundry", "bin", process.platform === "win32" ? `${n}.exe` : n);

export function rootEnv(): Record<string, string> {
  const f = join(ROOT, ".env");
  if (!existsSync(f)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

export const keys = rootEnv();
export const canRunChain =
  existsSync(bin("anvil")) && Boolean(keys.DEPLOYER_PRIVATE_KEY && keys.RELAYER_PRIVATE_KEY && keys.CREDIT_SIGNER_PRIVATE_KEY);

async function launch() {
  // ANVIL_PORT pins the port (the web e2e stack needs 8545, the browser default)
  const port = Number(process.env.ANVIL_PORT) || 18_000 + Math.floor(Math.random() * 2_000);
  const rpc = `http://127.0.0.1:${port}`;
  const anvil: ChildProcess = spawn(bin("anvil"), ["--port", String(port), "--chain-id", "31337", "--silent"], { stdio: "ignore" });
  const kill = () => {
    if (anvil.pid && process.platform === "win32") spawnSync("taskkill", ["/F", "/T", "/PID", String(anvil.pid)]);
    else anvil.kill();
  };
  const pub = createPublicClient({ chain: localChain, transport: http(rpc) });
  const testClient = createTestClient({ chain: localChain, mode: "anvil", transport: http(rpc) });
  try {
    for (let i = 0; ; i++) {
      try {
        await pub.getBlockNumber();
        break;
      } catch {
        if (i > 60) throw new Error("anvil did not start");
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    const { privateKeyToAccount } = await import("viem/accounts");
    for (const k of [keys.DEPLOYER_PRIVATE_KEY, keys.RELAYER_PRIVATE_KEY]) {
      await testClient.setBalance({ address: privateKeyToAccount(k as Hex).address, value: parseEther("100") });
    }
    // DRY_RUN=true broadcasts but does not rewrite contracts/deployments/31337.json
    try {
      await promisify(execFile)(bin("forge"), ["script", "script/Deploy.s.sol", "--rpc-url", rpc, "--broadcast"], {
        cwd: join(ROOT, "contracts"),
        env: { ...process.env, ...keys, DRY_RUN: "true" },
        timeout: 90_000,
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch (e) {
      const err = e as { stderr?: string; stdout?: string; killed?: boolean };
      const tail = (s?: string) => (s ?? "").split(/\r?\n/).filter(Boolean).slice(-15).join("\n");
      throw new Error(`forge deploy failed on ${rpc}${err.killed ? " (timed out)" : ""}\n--- stderr\n${tail(err.stderr)}\n--- stdout\n${tail(err.stdout)}`);
    }
    const code = await pub.getCode({ address: contractAddress(31337, "SignalBook") });
    if (!code || code === "0x") throw new Error("SignalBook not at the expected address; redeploy local + export");
  } catch (e) {
    kill();
    throw e;
  }
  return { rpc, pub, testClient, kill };
}

export async function startChain() {
  // forge's broadcast occasionally stalls waiting for receipts under load: one retry on a fresh anvil
  const { rpc, pub, testClient, kill } = await launch().catch((e) => {
    console.warn(`startChain retrying: ${(e as Error).message.split("\n")[0]}`);
    return launch();
  });

  await clearChainRows();
  process.env.RELAYER_PRIVATE_KEY = keys.RELAYER_PRIVATE_KEY;
  process.env.CREDIT_SIGNER_PRIVATE_KEY = keys.CREDIT_SIGNER_PRIVATE_KEY;
  process.env.LOCAL_RPC_URL = rpc;
  resetEnv();
  resetClients();

  const wallet = (account: PrivateKeyAccount) => createWalletClient({ account, chain: localChain, transport: http(rpc) });
  const usdt = paymentToken(31337);

  async function fund(account: PrivateKeyAccount, usd = "0") {
    await testClient.setBalance({ address: account.address, value: parseEther("10") });
    if (usd !== "0") await mint(usdt, account, BigInt(Math.round(Number(usd) * 1e6)));
  }

  async function mint(token: Hex, account: PrivateKeyAccount, amount: bigint) {
    const h = await wallet(account).writeContract({
      address: token,
      abi: [{ type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] }],
      functionName: "mint",
      args: [account.address, amount],
    });
    await pub.waitForTransactionReceipt({ hash: h });
  }

  async function transfer(account: PrivateKeyAccount, token: Hex, to: Hex, amount: bigint): Promise<Hex> {
    const h = await wallet(account).writeContract({ address: token, abi: erc20Abi, functionName: "transfer", args: [to, amount] });
    await pub.waitForTransactionReceipt({ hash: h });
    return h;
  }

  /** ERC-8004 identity + ProviderRegistry.register, then an optional USDT bond. */
  async function registerProvider(account: PrivateKeyAccount, opts: { practice?: boolean; bondUsd?: string } = {}) {
    await fund(account, opts.bondUsd ?? "0");
    const w = wallet(account);
    const h1 = await w.writeContract({
      address: contractAddress(31337, "IdentityRegistry"),
      abi: identityRegistryAbi,
      functionName: "register",
      args: ["https://nundina.test/agent.json"],
    });
    const rc = await pub.waitForTransactionReceipt({ hash: h1 });
    const [reg] = parseEventLogs({ abi: identityRegistryAbi, eventName: "Registered", logs: rc.logs });
    const registry = contractAddress(31337, "ProviderRegistry");
    const h2 = await w.writeContract({
      address: registry,
      abi: providerRegistryAbi,
      functionName: "register",
      args: [reg!.args.agentId, account.address, `0x${"00".repeat(32)}`, opts.practice ?? false],
    });
    await pub.waitForTransactionReceipt({ hash: h2 });
    if (opts.bondUsd) {
      const amount = BigInt(Math.round(Number(opts.bondUsd) * 1e6));
      await pub.waitForTransactionReceipt({ hash: await w.writeContract({ address: usdt, abi: erc20Abi, functionName: "approve", args: [registry, amount] }) });
      await pub.waitForTransactionReceipt({
        hash: await w.writeContract({ address: registry, abi: providerRegistryAbi, functionName: "depositBond", args: [amount] }),
      });
    }
  }

  /** Commits a BTC signal (default: long 81500 / TP 83000 / SL 80800) through the API's draft → prepare → sign → confirm flow. */
  async function commitViaApi(
    account: PrivateKeyAccount,
    userId: number,
    priceUnits: bigint,
    levels: { side: "LONG" | "SHORT"; entry: string; takeProfit: string; stopLoss: string } = { side: "LONG", entry: "81500", takeProfit: "83000", stopLoss: "80800" },
  ) {
    const asUser = { ...INTERNAL, "x-act-as-user": String(userId) };
    const d = await postJson("/drafts", { rawText: `BTC ${levels.side.toLowerCase()}`, parser: "manual" }, asUser);
    const block = await pub.getBlock();
    const signal = {
      market: "BTC/USD",
      side: levels.side,
      entry: toPrice(levels.entry).toString(),
      takeProfit: toPrice(levels.takeProfit).toString(),
      stopLoss: toPrice(levels.stopLoss).toString(),
      validUntil: String(Math.max(Number(block.timestamp), Math.floor(Date.now() / 1000)) + 3600),
      pricePerSub: priceUnits.toString(),
      upstream: [],
      upstreamBps: [],
    };
    const prep = await postJson(`/drafts/${d.body.id}/prepare`, signal, asUser);
    if (prep.status !== 200) throw new Error(`prepare failed: ${JSON.stringify(prep.body)}`);
    const td = prep.body.typedData;
    const providerSig = await account.signTypedData({
      domain: td.domain,
      types: td.types,
      primaryType: td.primaryType,
      message: {
        ...td.message,
        validUntil: BigInt(td.message.validUntil),
        pricePerSub: BigInt(td.message.pricePerSub),
        nonce: BigInt(td.message.nonce),
        deadline: BigInt(td.message.deadline),
      },
    });
    const ok = await postJson(`/drafts/${d.body.id}/confirm`, { signal, commitAuth: td.message, providerSig }, asUser);
    if (ok.status !== 201) throw new Error(`confirm failed: ${JSON.stringify(ok.body)}`);
    return { signalId: BigInt(ok.body.signalId), draftId: d.body.id as number, signal, prep: prep.body, providerSig };
  }

  function stop() {
    kill();
  }

  return { rpc, pub, testClient, wallet, usdt, fund, mint, transfer, registerProvider, commitViaApi, stop };
}
export type Chain = Awaited<ReturnType<typeof startChain>>;
