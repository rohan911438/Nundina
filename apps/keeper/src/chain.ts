/** On-chain reads the keeper bases every decision on. */
import type { Address, PublicClient } from "viem";
import { contractAddress } from "@nundina/shared";
import { outcomeResolverAbi, performanceEscrowAbi, signalBookAbi } from "@nundina/shared/abis";

export const BOOK_STATUS = ["NONE", "COMMITTED", "REVEALED", "UNREVEALED_LOSS"] as const;
export const POT_STATE = ["OPEN", "SETTLED", "REFUNDED"] as const;
export const OUTCOME = ["NONE", "WIN", "LOSS", "VOID"] as const;

export interface Addresses {
  book: Address;
  resolver: Address;
  escrow: Address;
  pushAdapter: Address;
  touchVerifier: Address;
}

export function addresses(chainId: number): Addresses {
  return {
    book: contractAddress(chainId, "SignalBook"),
    resolver: contractAddress(chainId, "OutcomeResolver"),
    escrow: contractAddress(chainId, "PerformanceEscrow"),
    pushAdapter: contractAddress(chainId, "PushPriceAdapter"),
    touchVerifier: contractAddress(chainId, "TouchVerifier"),
  };
}

export type OnchainSignal = Awaited<ReturnType<typeof readSignal>>;

/** Everything about one signal, in one round of reads. */
export async function readSignal(pub: PublicClient, a: Addresses, id: bigint) {
  const [record, state, outcome, pot] = await Promise.all([
    pub.readContract({ address: a.book, abi: signalBookAbi, functionName: "getSignal", args: [id] }),
    pub.readContract({ address: a.resolver, abi: outcomeResolverAbi, functionName: "stateOf", args: [id] }),
    pub.readContract({ address: a.resolver, abi: outcomeResolverAbi, functionName: "outcomeOf", args: [id] }),
    pub.readContract({ address: a.escrow, abi: performanceEscrowAbi, functionName: "potOf", args: [id] }),
  ]);
  return {
    id,
    status: BOOK_STATUS[record.status]!,
    isLimit: record.isLimit,
    committedAt: Number(record.committedAt),
    validUntil: Number(record.validUntil),
    market: record.market,
    oraclePriceAtCommit: record.oraclePriceAtCommit,
    resolver: {
      final: state.final_,
      pendingLevel: state.pendingLevel,
      pendingTs: Number(state.pendingTs),
      pendingAt: Number(state.pendingAt),
      entryTouchedAt: Number(state.entryTouchedAt),
    },
    outcome: OUTCOME[outcome[0]]!,
    outcomeFinal: outcome[2],
    pot: POT_STATE[pot.state]!,
  };
}

export async function readConfig(pub: PublicClient, a: Addresses) {
  const [touchProofsEnabled, challengeWindow, revealWindow] = await Promise.all([
    pub.readContract({ address: a.resolver, abi: outcomeResolverAbi, functionName: "touchProofsEnabled" }),
    pub.readContract({ address: a.resolver, abi: outcomeResolverAbi, functionName: "CHALLENGE_WINDOW" }),
    pub.readContract({ address: a.book, abi: signalBookAbi, functionName: "REVEAL_WINDOW" }),
  ]);
  return { touchProofsEnabled, challengeWindow: Number(challengeWindow), revealWindow: Number(revealWindow) };
}

/** Chain time (latest block), which every window check uses. */
export async function chainNow(pub: PublicClient) {
  return Number((await pub.getBlock({ blockTag: "latest" })).timestamp);
}
