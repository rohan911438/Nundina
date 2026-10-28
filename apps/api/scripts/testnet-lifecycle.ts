/**
 * Real-transaction lifecycle on HashKey testnet (chain 133), no payment tokens needed:
 *   A. an expired, revealed signal → resolveAtExpiry (push oracle) → finalize → settle
 *   B. a fresh practice signal → commit (provider signs, relayer sends) → reveal → keeper posts a
 *      TP touch → proveTouch → finalize after the challenge window → settle
 * Prints every tx with its explorer link and checks the end state. Uses DEPLOYER (as the provider),
 * RELAYER and KEEPER keys from .env.
 *
 *   pnpm --filter @nundina/api exec tsx --env-file=../../.env scripts/testnet-lifecycle.ts
 *   … scripts/testnet-lifecycle.ts 3 4     only finalize + settle these signal ids
 */
import { parseEventLogs, createPublicClient, createWalletClient, encodeAbiParameters, http, keccak256, toHex, type Abi, type Address, type Hex } from "viem";
import { nonceManager, privateKeyToAccount } from "viem/accounts";
import { contractAddress, explorerTx, hashkeyTestnet } from "@nundina/shared";
import { identityRegistryAbi, mockPriceAdapterAbi, outcomeResolverAbi, performanceEscrowAbi, providerRegistryAbi, signalBookAbi } from "@nundina/shared/abis";

const CHAIN = 133;
const rpc = process.env.HSK_TESTNET_RPC_URL || hashkeyTestnet.rpcUrls.default.http[0];
const pub = createPublicClient({ chain: hashkeyTestnet, transport: http(rpc) });
const key = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} missing in .env`);
  // local nonces: a lagging RPC node can hand back a stale pending nonce ("replacement transaction underpriced")
  return privateKeyToAccount(v as Hex, { nonceManager });
};
const provider = key("DEPLOYER_PRIVATE_KEY");
const relayer = key("RELAYER_PRIVATE_KEY");
const keeper = key("KEEPER_PRIVATE_KEY");
const wallet = (acct: ReturnType<typeof key>) => createWalletClient({ account: acct, chain: hashkeyTestnet, transport: http(rpc) });

const book = contractAddress(CHAIN, "SignalBook");
const resolver = contractAddress(CHAIN, "OutcomeResolver");
const escrow = contractAddress(CHAIN, "PerformanceEscrow");
const oracle = contractAddress(CHAIN, "PushPriceAdapter");
const identity = contractAddress(CHAIN, "IdentityRegistry");
const registry = contractAddress(CHAIN, "ProviderRegistry");
const BTC = keccak256(toHex("BTC/USD"));

type Signal = {
  provider: Address;
  market: Hex;
  side: number;
  entry: bigint;
  takeProfit: bigint;
  stopLoss: bigint;
  validUntil: bigint;
  pricePerSub: bigint;
  upstream: readonly bigint[];
  upstreamBps: readonly number[];
  salt: Hex;
};

async function send(label: string, acct: ReturnType<typeof key>, address: Address, abi: Abi, functionName: string, args: readonly unknown[]) {
  // the public RPC is load-balanced: a node can lag the previous tx by a block, so retry the simulation
  let request: unknown;
  for (let i = 0; ; i++) {
    try {
      ({ request } = await pub.simulateContract({ account: acct, address, abi, functionName, args } as never));
      break;
    } catch (e) {
      if (i >= 4) throw e;
      await new Promise((r) => setTimeout(r, 3_000));
    }
  }
  const hash = await wallet(acct).writeContract(request as never);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  console.log(`  ✓ ${label.padEnd(34)} gas ${String(r.gasUsed).padStart(7)}  ${explorerTx(CHAIN, hash)}`);
  return r;
}

const now = async () => (await pub.getBlock()).timestamp;

/** Revealed signals from the event log (chunked: the public RPC caps log ranges). */
async function revealedSignals(): Promise<{ id: bigint; s: Signal }[]> {
  const start = 34_969_274n;
  const head = await pub.getBlockNumber();
  const out: { id: bigint; s: Signal }[] = [];
  for (let from = start; from <= head; from += 5_000n) {
    const logs = await pub.getContractEvents({ address: book, abi: signalBookAbi, eventName: "SignalRevealed", fromBlock: from, toBlock: from + 4_999n > head ? head : from + 4_999n });
    for (const l of logs) out.push({ id: l.args.id!, s: l.args.s as unknown as Signal });
  }
  return out;
}

async function finalState(id: bigint, blockNumber?: bigint): Promise<{ outcome: string | undefined; final: boolean; pot: string | undefined }> {
  // a lagging node may not have the receipt's block yet ("block not found"): retry a few times
  for (let i = 0; ; i++) {
    try {
      return await readState(id, blockNumber);
    } catch (e) {
      if (i >= 4) throw e;
      await new Promise((r) => setTimeout(r, 3_000));
    }
  }
}

async function readState(id: bigint, blockNumber?: bigint) {
  const [o, , fin] = (await pub.readContract({ address: resolver, abi: outcomeResolverAbi, functionName: "outcomeOf", args: [id], blockNumber })) as [number, bigint, boolean];
  const pot = (await pub.readContract({ address: escrow, abi: performanceEscrowAbi, functionName: "potOf", args: [id], blockNumber })) as { state: number };
  return { outcome: ["NONE", "WIN", "LOSS", "VOID"][o], final: fin, pot: ["OPEN", "SETTLED", "REFUNDED"][pot.state] };
}

async function finalizeAll(ids: bigint[]) {
  for (const x of ids) {
    const st = await finalState(x);
    let at: bigint | undefined;
    if (!st.final) at = (await send(`finalize #${x}`, keeper, resolver, outcomeResolverAbi as Abi, "finalize", [x])).blockNumber;
    if (st.pot === "OPEN") at = (await send(`settle #${x}`, keeper, escrow, performanceEscrowAbi as Abi, "settle", [x])).blockNumber;
    console.log(`  → #${x}`, await finalState(x, at)); // read at the receipt block: the next node may lag
  }
}

async function main() {
  const only = process.argv.slice(2).map(BigInt);
  if (only.length) return finalizeAll(only);
  console.log(`chain ${CHAIN} via ${rpc}\nprovider ${provider.address}  relayer ${relayer.address}  keeper ${keeper.address}\n`);
  const ids: bigint[] = [];

  // ── A. expired signal → resolve at expiry
  const t = await now();
  const expired = (await revealedSignals()).filter((x) => x.s.validUntil < t);
  for (const { id, s } of expired) {
    const st = (await pub.readContract({ address: resolver, abi: outcomeResolverAbi, functionName: "stateOf", args: [id] })) as { pendingTs: bigint; final_: boolean };
    if (st.final_) continue;
    if (st.pendingTs !== 0n) {
      ids.push(id); // resolved by an earlier run: just finalize and settle
      continue;
    }
    console.log(`A. signal #${id} expired ${new Date(Number(s.validUntil) * 1000).toISOString()}: resolve at expiry`);
    // the mock push feed has no round counter: find the round in effect at validUntil
    let hint = -1;
    for (let h = 0; h < 64; h++) {
      try {
        await pub.readContract({ address: oracle, abi: mockPriceAdapterAbi, functionName: "priceAt", args: [BTC, s.validUntil, BigInt(h)] });
        hint = h;
        break;
      } catch {
        /* next */
      }
    }
    if (hint < 0) {
      // no round before expiry: the keeper never pushed one, so price it now (still ≤ the proof tolerance is not needed for push)
      console.log("  no oracle round at expiry; skipping (needs a keeper push before expiry)");
      continue;
    }
    await send(`resolveAtExpiry #${id} (round ${hint})`, keeper, resolver, outcomeResolverAbi as Abi, "resolveAtExpiry", [id, s, BigInt(hint)]);
    ids.push(id);
  }

  // ── B. fresh practice signal with a proven TP touch
  // a fresh deploy has no providers: register the deployer as a practice provider (no bond needed)
  if (!(await pub.readContract({ address: registry, abi: providerRegistryAbi, functionName: "isRegistered", args: [provider.address] }))) {
    console.log("\nregister provider");
    const rr = await send("ERC-8004 identity", provider, identity, identityRegistryAbi as Abi, "register", ["https://nundina.xyz/agents/lifecycle.json"]);
    const agentId = (parseEventLogs({ abi: identityRegistryAbi, eventName: "Registered", logs: rr.logs })[0]!.args as { agentId: bigint }).agentId;
    await send(`register practice provider (#${agentId})`, provider, registry, providerRegistryAbi as Abi, "register", [agentId, provider.address, keccak256(toHex("@nundina_lifecycle")), true]);
  }
  const spot = (await pub.readContract({ address: resolver, abi: outcomeResolverAbi, functionName: "spotPrice", args: [BTC] }).catch(() => 0n)) as bigint;
  const ref = spot || 8_000_000_000_000n;
  if (!spot) {
    await send("oracle push spot (keeper)", keeper, oracle, mockPriceAdapterAbi as Abi, "push", [BTC, ref, await now()]);
  }
  const t0 = await now();
  const s: Signal = {
    provider: provider.address,
    market: BTC,
    side: 0,
    entry: ref,
    takeProfit: (ref * 102n) / 100n,
    stopLoss: (ref * 99n) / 100n,
    validUntil: t0 + 3_600n,
    pricePerSub: 0n,
    upstream: [],
    upstreamBps: [],
    salt: keccak256(toHex(`lifecycle-${t0}`)),
  };
  const commitHash = (await pub.readContract({ address: book, abi: signalBookAbi, functionName: "hashSignal", args: [s] })) as Hex;
  const nonce = (await pub.readContract({ address: book, abi: signalBookAbi, functionName: "nonces", args: [provider.address] })) as bigint;
  const auth = { provider: provider.address, commitHash, market: BTC, validUntil: s.validUntil, pricePerSub: 0n, nonce, deadline: t0 + 1_800n };
  const sig = await provider.signTypedData({
    domain: { name: "Nundina", version: "1", chainId: CHAIN, verifyingContract: book },
    types: {
      CommitAuthorization: [
        { name: "provider", type: "address" },
        { name: "commitHash", type: "bytes32" },
        { name: "market", type: "bytes32" },
        { name: "validUntil", type: "uint64" },
        { name: "pricePerSub", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint64" },
      ],
    },
    primaryType: "CommitAuthorization",
    message: auth,
  });
  console.log("\nB. fresh practice signal");
  const cr = await send("commit (relayer, provider-signed)", relayer, book, signalBookAbi as Abi, "commit", [auth, sig, [], [], "lifecycle://"]);
  // read the id from the receipt itself (a lagging RPC node may not serve logs for the new block yet)
  const committed = parseEventLogs({ abi: signalBookAbi, eventName: "SignalCommitted", logs: cr.logs });
  const id = (committed[0]!.args as { id: bigint }).id;
  console.log(`  signal #${id}`);
  await send(`reveal #${id}`, relayer, book, signalBookAbi as Abi, "reveal", [id, s]);
  const touchTs = await now();
  const touchPx = s.takeProfit + 100_000_000n; // TP + $1
  await send("oracle posts TP touch (keeper)", keeper, oracle, mockPriceAdapterAbi as Abi, "postTouch", [BTC, touchPx, touchTs]);
  const proof = encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }, { type: "uint64" }], [BTC, touchPx, touchTs]);
  await send(`proveTouch TP #${id}`, keeper, resolver, outcomeResolverAbi as Abi, "proveTouch", [id, s, 0, proof]);
  ids.push(id);

  // ── finalize + settle after the challenge window
  const wait = 10 * 60 + 20;
  console.log(`\nwaiting ${wait}s for the challenge window…`);
  await new Promise((r) => setTimeout(r, wait * 1000));
  await finalizeAll(ids);
  const b = await finalState(id);
  if (b.outcome !== "WIN" || !b.final || b.pot !== "SETTLED") throw new Error(`B ended ${JSON.stringify(b)}`);
  console.log("\nlifecycle OK");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
