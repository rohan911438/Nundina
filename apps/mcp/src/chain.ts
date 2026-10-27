import { createPublicClient, http, type PublicClient } from "viem";
import { chainById, contractAddress, explorerTx } from "@nundina/shared";
import { outcomeResolverAbi, signalBookAbi } from "@nundina/shared/abis";
import { env } from "./env.js";

export const chain = () => chainById(env().CHAIN_ID);
export function rpcUrl() {
  const e = env();
  return e.RPC_URL ?? ({ 31337: e.LOCAL_RPC_URL, 133: e.HSK_TESTNET_RPC_URL, 177: e.HSK_RPC_URL } as Record<number, string | undefined>)[e.CHAIN_ID] ?? chain().rpcUrls.default.http[0];
}

let client: PublicClient | undefined;
export function pub(): PublicClient {
  return (client ??= createPublicClient({ chain: chain(), transport: http(rpcUrl()) }) as PublicClient);
}
export const resetChain = () => {
  client = undefined;
};

const BOOK_STATUS = ["NONE", "COMMITTED", "REVEALED", "UNREVEALED_LOSS"] as const;
const OUTCOME = ["NONE", "WIN", "LOSS", "VOID"] as const;

/** What the chain says about one signal: status, commit hash, outcome, R multiple, and revealed levels. */
export async function onchainSignal(id: bigint) {
  const c = env().CHAIN_ID;
  const book = contractAddress(c, "SignalBook");
  const resolver = contractAddress(c, "OutcomeResolver");
  const [rec, out] = await Promise.all([
    pub().readContract({ address: book, abi: signalBookAbi, functionName: "getSignal", args: [id] }),
    pub().readContract({ address: resolver, abi: outcomeResolverAbi, functionName: "outcomeOf", args: [id] }),
  ]);
  const status = BOOK_STATUS[rec.status]!;
  const revealed =
    status === "REVEALED" ? await pub().readContract({ address: book, abi: signalBookAbi, functionName: "revealedSignal", args: [id] }) : null;
  return {
    status,
    commitHash: rec.commitHash,
    committedAt: Number(rec.committedAt),
    outcome: OUTCOME[out[0]]!,
    rMultiple: Number(out[1]) / 100,
    final: out[2],
    revealed,
  };
}

export const txUrl = (hash: string | null | undefined) => (hash ? explorerTx(env().CHAIN_ID, hash) : null);
