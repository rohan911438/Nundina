/** APRO push feeds (Chainlink-style): the latest round decides whether expiry can use the push feed. */
import type { Address, PublicClient } from "viem";

const aggregatorAbi = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
] as const;

/** Latest round id and publish time (EOA reads are allowed; contracts need APRO's allowlist). */
export async function latestRound(pub: PublicClient, feed: Address) {
  const [roundId, , , updatedAt] = await pub.readContract({ address: feed, abi: aggregatorAbi, functionName: "latestRoundData" });
  return { roundId, updatedAt: Number(updatedAt) };
}
