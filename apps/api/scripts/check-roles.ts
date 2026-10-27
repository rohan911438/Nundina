/**
 * Pre-launch check (prompt 15, Part A): reads every role, set-once wire and launch parameter on-chain
 * and compares it with what `contracts/script/Deploy.s.sol` + `Config.s.sol` say. Exits 1 on any miss.
 *
 *   CHAIN_ID=177 HSK_RPC_URL=… pnpm contracts:check-roles
 * Actor addresses come from the same env Deploy reads (RELAYER_ADDRESS, CREDIT_SIGNER_ADDRESS,
 * TREASURY_ADDRESS, KEEPER_ADDRESS, DEPLOYER_ADDRESS); unset ones are skipped, not assumed.
 */
import { createPublicClient, getAddress, http, keccak256, toBytes, type Address } from "viem";
import { chainById, deployment } from "@nundina/shared";
import {
  outcomeResolverAbi,
  performanceEscrowAbi,
  providerRegistryAbi,
  reputationRegistryAbi,
  revenueRouterAbi,
  signalBookAbi,
  signerCreditVerifierAbi,
} from "@nundina/shared/abis";

const chainId = Number(process.env.CHAIN_ID ?? 31337);
const rpc =
  process.env.RPC_URL ??
  (chainId === 177 ? process.env.HSK_RPC_URL : chainId === 133 ? process.env.HSK_TESTNET_RPC_URL : process.env.LOCAL_RPC_URL) ??
  chainById(chainId).rpcUrls.default.http[0];
const pub = createPublicClient({ chain: chainById(chainId), transport: http(rpc) });
const d = deployment(chainId) as Record<string, Address>;
const env = (k: string) => (process.env[k] ? getAddress(process.env[k]!) : undefined);

const ADMIN = "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
const hasRoleAbi = [{ type: "function", name: "hasRole", stateMutability: "view", inputs: [{ name: "role", type: "bytes32" }, { name: "account", type: "address" }], outputs: [{ type: "bool" }] }] as const;
const delayAbi = [{ type: "function", name: "getMinDelay", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }] as const;

let fails = 0;
const check = (ok: boolean, what: string, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? `  (${detail})` : ""}`);
};
const has = (addr: Address, role: `0x${string}`, who: Address) => pub.readContract({ address: addr, abi: hasRoleAbi, functionName: "hasRole", args: [role, who] });
const same = (a: string, b: string) => getAddress(a) === getAddress(b);

const EXPECT = chainId === 177 ? { maxPrice: 5_000_000n, maxSubs: 50n, delay: 86_400n } : chainId === 133 ? { maxPrice: 50_000_000n, maxSubs: 200n, delay: 3_600n } : { maxPrice: 50_000_000n, maxSubs: 200n, delay: undefined };

async function main() {
  console.log(`chain ${chainId} via ${rpc}\n`);
  const timelock = d.Timelock!;
  const deployer = env("DEPLOYER_ADDRESS");
  const admins = ["ReputationRegistry", "OutcomeResolver", "ProviderRegistry", "SignalBook", "RevenueRouter", "SignerCreditVerifier", "PerformanceEscrow", "AproPushAdapter", "SupraPushAdapter", "PushPriceAdapter"];
  for (const name of admins) {
    const a = d[name];
    if (!a || /^0x0+$/.test(a)) continue;
    check(await has(a, ADMIN, timelock), `${name}: timelock is admin`);
    if (deployer) check(!(await has(a, ADMIN, deployer)), `${name}: deployer renounced admin`);
  }
  if (EXPECT.delay != null) {
    const delay = await pub.readContract({ address: timelock, abi: delayAbi, functionName: "getMinDelay" });
    check(delay >= EXPECT.delay, "Timelock min delay", `${delay}s, expected ≥ ${EXPECT.delay}s`);
  }

  // roles
  const relayer = env("RELAYER_ADDRESS");
  const book = d.SignalBook!;
  if (relayer) {
    const role = await pub.readContract({ address: book, abi: signalBookAbi, functionName: "RELAYER_ROLE" });
    check(await has(book, role, relayer), "SignalBook: RELAYER_ROLE → relayer");
  }
  const writer = await pub.readContract({ address: d.ReputationRegistry!, abi: reputationRegistryAbi, functionName: "WRITER_ROLE" });
  check(await has(d.ReputationRegistry!, writer, d.PerformanceEscrow!), "ReputationRegistry: WRITER_ROLE → escrow");
  const keeper = env("KEEPER_ADDRESS");
  if (keeper && chainId !== 177 && d.PushPriceAdapter && !/^0x0+$/.test(d.PushPriceAdapter)) {
    check(await has(d.PushPriceAdapter, keccak256(toBytes("UPDATER_ROLE")), keeper), "MockPriceAdapter: UPDATER_ROLE → keeper");
  }

  // set-once wiring
  check(same(await pub.readContract({ address: d.ProviderRegistry!, abi: providerRegistryAbi, functionName: "escrow" }), d.PerformanceEscrow!), "ProviderRegistry.escrow");
  check(same(await pub.readContract({ address: d.RevenueRouter!, abi: revenueRouterAbi, functionName: "escrow" }), d.PerformanceEscrow!), "RevenueRouter.escrow");
  check(same(await pub.readContract({ address: book, abi: signalBookAbi, functionName: "resolver" }), d.OutcomeResolver!), "SignalBook.resolver");
  check(same(await pub.readContract({ address: d.OutcomeResolver!, abi: outcomeResolverAbi, functionName: "book" }), book), "OutcomeResolver.book");
  check(same(await pub.readContract({ address: d.PerformanceEscrow!, abi: performanceEscrowAbi, functionName: "creditVerifier" }), d.SignerCreditVerifier!), "PerformanceEscrow.creditVerifier");

  // launch parameters
  const signer = env("CREDIT_SIGNER_ADDRESS");
  if (signer) check(same(await pub.readContract({ address: d.SignerCreditVerifier!, abi: signerCreditVerifierAbi, functionName: "signer" }), signer), "SignerCreditVerifier.signer → credit signer");
  const treasury = env("TREASURY_ADDRESS");
  if (treasury) check(same(await pub.readContract({ address: d.PerformanceEscrow!, abi: performanceEscrowAbi, functionName: "treasury" }), treasury), "PerformanceEscrow.treasury");
  const fee = await pub.readContract({ address: d.PerformanceEscrow!, abi: performanceEscrowAbi, functionName: "feeBps" });
  check(fee <= 2000n, "PerformanceEscrow.feeBps ≤ 20%", `${fee} bps`);
  const subs = await pub.readContract({ address: d.PerformanceEscrow!, abi: performanceEscrowAbi, functionName: "maxSubscribers" });
  check(subs === EXPECT.maxSubs, "PerformanceEscrow.maxSubscribers", `${subs}, expected ${EXPECT.maxSubs}`);
  const price = await pub.readContract({ address: book, abi: signalBookAbi, functionName: "maxPricePerSub" });
  check(price === EXPECT.maxPrice, "SignalBook.maxPricePerSub", `${price}, expected ${EXPECT.maxPrice}`);
  const touch = await pub.readContract({ address: d.OutcomeResolver!, abi: outcomeResolverAbi, functionName: "touchProofsEnabled" });
  check(chainId !== 177 || touch === false, "OutcomeResolver.touchProofsEnabled off on mainnet until Supra proofs are confirmed", String(touch));
  if (chainId === 177) check(!d.PushPriceAdapter || d.PushPriceAdapter !== d.TouchVerifier || /^0x0+$/.test(d.PushPriceAdapter), "MockPriceAdapter not wired as the touch verifier on mainnet");

  console.log(`\n${fails ? `${fails} check(s) FAILED` : "all checks passed"}`);
  process.exit(fails ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
