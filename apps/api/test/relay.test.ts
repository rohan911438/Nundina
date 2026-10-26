/**
 * Commit relay end to end: fresh anvil (port 8546) + `forge script Deploy` with the repo's local
 * deployer, so the contracts land at the addresses in packages/shared/src/addresses.json.
 * Skips when Foundry or the local deployer/relayer keys are missing.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { createPublicClient, createTestClient, createWalletClient, http, parseEther, parseEventLogs, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { contractAddress, localChain, toPrice } from "@nundina/shared";
import { identityRegistryAbi, providerRegistryAbi, signalBookAbi } from "@nundina/shared/abis";
import { closeDb, db } from "../src/db/client.js";
import { relayedTxs, signalDrafts, signals } from "../src/db/schema.js";
import { resetEnv } from "../src/env.js";
import { resetClients } from "../src/chain/clients.js";
import { stopQueue } from "../src/jobs/queue.js";
import { decryptSignal } from "../src/services/keyService.js";
import { getJson, INTERNAL, makeProvider, postJson } from "./helpers.js";

const ROOT = join(__dirname, "..", "..", "..");
const PORT = 18_000 + Math.floor(Math.random() * 2_000);
const RPC = `http://127.0.0.1:${PORT}`;
const bin = (n: string) => join(homedir(), ".foundry", "bin", process.platform === "win32" ? `${n}.exe` : n);

function rootEnv(): Record<string, string> {
  const f = join(ROOT, ".env");
  if (!existsSync(f)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

const keys = rootEnv();
const canRun = existsSync(bin("anvil")) && Boolean(keys.DEPLOYER_PRIVATE_KEY) && Boolean(keys.RELAYER_PRIVATE_KEY);

let anvil: ChildProcess | undefined;
const pub = createPublicClient({ chain: localChain, transport: http(RPC) });
const testClient = createTestClient({ chain: localChain, mode: "anvil", transport: http(RPC) });

async function waitForRpc() {
  for (let i = 0; i < 60; i++) {
    try {
      await pub.getBlockNumber();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error("anvil did not start");
}

describe.skipIf(!canRun)("commit relay (anvil)", () => {
  const providerKey = generatePrivateKey();
  const provider = privateKeyToAccount(providerKey);

  beforeAll(async () => {
    anvil = spawn(bin("anvil"), ["--port", String(PORT), "--chain-id", "31337", "--silent"], { stdio: "ignore" });
    await waitForRpc();
    const deployer = privateKeyToAccount(keys.DEPLOYER_PRIVATE_KEY as Hex);
    const relayer = privateKeyToAccount(keys.RELAYER_PRIVATE_KEY as Hex);
    for (const a of [deployer.address, relayer.address, provider.address]) {
      await testClient.setBalance({ address: a, value: parseEther("100") });
    }
    // DRY_RUN=true broadcasts but does not rewrite contracts/deployments/31337.json
    await promisify(execFile)(bin("forge"), ["script", "script/Deploy.s.sol", "--rpc-url", RPC, "--broadcast"], {
      cwd: join(ROOT, "contracts"),
      env: { ...process.env, ...keys, DRY_RUN: "true" },
      timeout: 150_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    const book = contractAddress(31337, "SignalBook");
    const code = await pub.getCode({ address: book });
    if (!code || code === "0x") throw new Error("SignalBook not at the expected address; redeploy local + export");

    // provider registers on-chain (identity + practice profile so price may be 0)
    const w = createWalletClient({ account: provider, chain: localChain, transport: http(RPC) });
    const h1 = await w.writeContract({
      address: contractAddress(31337, "IdentityRegistry"),
      abi: identityRegistryAbi,
      functionName: "register",
      args: ["https://nundina.test/agent.json"],
    });
    const rc = await pub.waitForTransactionReceipt({ hash: h1 });
    const [reg] = parseEventLogs({ abi: identityRegistryAbi, eventName: "Registered", logs: rc.logs });
    if (!reg) throw new Error("no Registered event");
    const h2 = await w.writeContract({
      address: contractAddress(31337, "ProviderRegistry"),
      abi: providerRegistryAbi,
      functionName: "register",
      args: [reg.args.agentId, provider.address, `0x${"00".repeat(32)}`, true],
    });
    await pub.waitForTransactionReceipt({ hash: h2 });

    process.env.RELAYER_PRIVATE_KEY = keys.RELAYER_PRIVATE_KEY;
    process.env.LOCAL_RPC_URL = RPC;
    resetEnv();
    resetClients();
  });

  afterAll(async () => {
    await stopQueue();
    await closeDb();
    if (anvil?.pid && process.platform === "win32") spawnSync("taskkill", ["/F", "/T", "/PID", String(anvil.pid)]);
    else anvil?.kill();
  });

  it("prepare → sign → confirm commits on-chain, stores ciphertext, is idempotent", async () => {
    const { userId } = await makeProvider({ address: provider.address, practice: true });
    const asUser = { ...INTERNAL, "x-act-as-user": String(userId) };

    const created = await postJson("/drafts", { rawText: "BTC long 81500 tp 83000 sl 80800", parser: "manual" }, asUser);
    expect(created.status).toBe(201);
    const id = created.body.id;

    const now = Math.floor(Date.now() / 1000);
    const block = await pub.getBlock();
    const validUntil = Number(block.timestamp) + 3600 > now + 3600 ? Number(block.timestamp) + 3600 : now + 3600;
    const signal = {
      market: "BTC/USD",
      side: "LONG",
      entry: toPrice("81500").toString(),
      takeProfit: toPrice("83000").toString(),
      stopLoss: toPrice("80800").toString(),
      validUntil: String(validUntil),
      pricePerSub: "0",
      upstream: [],
      upstreamBps: [],
    };
    const prep = await postJson(`/drafts/${id}/prepare`, signal, asUser);
    expect(prep.status).toBe(200);
    expect(prep.body.salt).toMatch(/^0x[0-9a-f]{64}$/);

    const td = prep.body.typedData;
    const msg = {
      ...td.message,
      validUntil: BigInt(td.message.validUntil),
      pricePerSub: BigInt(td.message.pricePerSub),
      nonce: BigInt(td.message.nonce),
      deadline: BigInt(td.message.deadline),
    };
    const providerSig = await provider.signTypedData({ domain: td.domain, types: td.types, primaryType: td.primaryType, message: msg });

    // a tampered signal is rejected before anything is relayed
    const bad = await postJson(
      `/drafts/${id}/confirm`,
      { signal: { ...signal, takeProfit: toPrice("84000").toString() }, commitAuth: td.message, providerSig },
      asUser,
    );
    expect(bad.status).toBe(400);

    const ok = await postJson(`/drafts/${id}/confirm`, { signal, commitAuth: td.message, providerSig }, asUser);
    expect(ok.status).toBe(201);
    const signalId = BigInt(ok.body.signalId);

    const onchain = await pub.readContract({
      address: contractAddress(31337, "SignalBook"),
      abi: signalBookAbi,
      functionName: "getSignal",
      args: [signalId],
    });
    expect((onchain as { commitHash: Hex }).commitHash).toBe(prep.body.commitHash);

    const row = await db().query.signals.findFirst({ where: eq(signals.id, signalId) });
    expect(row?.status).toBe("COMMITTED");
    expect(row?.entry).toBeNull(); // plaintext not stored in clear
    const body = decryptSignal({ ciphertext: row!.ciphertext!, aesKeyEnc: row!.aesKeyEnc! });
    expect(body.entry).toBe(signal.entry);

    // idempotent: second confirm returns the same signal without a new tx
    const again = await postJson(`/drafts/${id}/confirm`, { signal, commitAuth: td.message, providerSig }, asUser);
    expect(again.body.signalId).toBe(ok.body.signalId);
    const txs = await db().select().from(relayedTxs).where(eq(relayedTxs.idempotencyKey, `commit:draft:${id}`));
    expect(txs).toHaveLength(1);
    const draft = await db().query.signalDrafts.findFirst({ where: eq(signalDrafts.id, id) });
    expect(draft?.status).toBe("committed");

    // public view hides the plaintext
    const pubView = await getJson(`/signals/${signalId}`);
    expect(pubView.body.entry).toBeNull();

    const health = await getJson("/health");
    expect(health.body.rpc.ok).toBe(true);
    expect(health.body.relayer.canSend).toBe(true);
  });

  it("another user cannot confirm someone else's draft", async () => {
    const owner = await makeProvider({ address: privateKeyToAccount(generatePrivateKey()).address });
    const stranger = await makeProvider({ address: privateKeyToAccount(generatePrivateKey()).address });
    const d = await postJson("/drafts", { rawText: "x" }, { ...INTERNAL, "x-act-as-user": String(owner.userId) });
    const r = await postJson(`/drafts/${d.body.id}/prepare`, {}, { ...INTERNAL, "x-act-as-user": String(stranger.userId) });
    expect(r.status).toBe(403);
  });
});
