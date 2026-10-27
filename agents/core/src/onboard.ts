import { erc20Abi, keccak256, parseEventLogs, toBytes } from "viem";
import { contractAddress, paymentToken, toUnits } from "@nundina/shared";
import { identityRegistryAbi, providerRegistryAbi } from "@nundina/shared/abis";
import { env } from "./env.js";
import type { Nundina } from "./nundina.js";
import type { AgentWallet } from "./wallet.js";

export interface Profile {
  name: string;
  type: "strategy" | "aggregator";
  handle: string;
  displayName: string;
  bio: string;
  defaultPriceUsd: string;
}

/**
 * Registers an agent like any human provider: API profile + agent row (with its encryption key),
 * ERC-8004 identity, ProviderRegistry registration and a bond. Idempotent; safe on every start.
 */
export async function onboardProvider(api: Nundina, w: AgentWallet, p: Profile) {
  const r = await api.register({ name: p.name, type: p.type, wallet: w.address, provider: { handle: p.handle, displayName: p.displayName, bio: p.bio, defaultPriceUsd: p.defaultPriceUsd } });
  const chainId = env().CHAIN_ID;
  const registry = contractAddress(chainId, "ProviderRegistry");
  const registered = await w.pub.readContract({ address: registry, abi: providerRegistryAbi, functionName: "isRegistered", args: [w.address] });
  if (!registered) {
    const web = (process.env.WEB_ORIGIN ?? "https://nundina.xyz").split(",")[0]!.trim();
    const h1 = await w.wallet.writeContract({
      address: contractAddress(chainId, "IdentityRegistry"),
      abi: identityRegistryAbi,
      functionName: "register",
      args: [`${web}/api/agent-card/${p.handle}`],
    });
    const rc = await w.pub.waitForTransactionReceipt({ hash: h1 });
    const [ev] = parseEventLogs({ abi: identityRegistryAbi, eventName: "Registered", logs: rc.logs });
    if (!ev) throw new Error("ERC-8004 Registered event missing");
    const h2 = await w.wallet.writeContract({
      address: registry,
      abi: providerRegistryAbi,
      functionName: "register",
      args: [ev.args.agentId, w.address, keccak256(toBytes(`@${p.handle}`)), false],
    });
    await w.pub.waitForTransactionReceipt({ hash: h2 });
  }
  await topUpBond(w, toUnits(env().AGENT_BOND_USD));
  return r;
}

/** Keeps at least `target` of free bond so buyers have capacity. */
export async function topUpBond(w: AgentWallet, target: bigint) {
  const chainId = env().CHAIN_ID;
  const registry = contractAddress(chainId, "ProviderRegistry");
  const free = await w.pub.readContract({ address: registry, abi: providerRegistryAbi, functionName: "freeBond", args: [w.address] });
  if (free >= target) return 0n;
  const need = target - free;
  const token = paymentToken(chainId);
  const bal = await w.pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [w.address] });
  if (bal < need) {
    console.warn(`${w.address}: bond top-up needs ${need} but wallet holds ${bal}; skipping`);
    return 0n;
  }
  await w.pub.waitForTransactionReceipt({ hash: await w.wallet.writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [registry, need] }) });
  await w.pub.waitForTransactionReceipt({ hash: await w.wallet.writeContract({ address: registry, abi: providerRegistryAbi, functionName: "depositBond", args: [need] }) });
  return need;
}
