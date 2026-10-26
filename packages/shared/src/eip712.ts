import type { Address, TypedDataDomain } from "viem";

export const EIP712_NAME = "Nundina";
export const EIP712_VERSION = "1";

export function nundinaDomain(chainId: number, signalBook: Address) {
  return {
    name: EIP712_NAME,
    version: EIP712_VERSION,
    chainId,
    verifyingContract: signalBook,
  } as const satisfies TypedDataDomain;
}

export const SIGNAL_TYPES = {
  Signal: [
    { name: "provider", type: "address" },
    { name: "market", type: "bytes32" },
    { name: "side", type: "uint8" },
    { name: "entry", type: "uint256" },
    { name: "takeProfit", type: "uint256" },
    { name: "stopLoss", type: "uint256" },
    { name: "validUntil", type: "uint64" },
    { name: "pricePerSub", type: "uint256" },
    { name: "upstream", type: "uint256[]" },
    { name: "upstreamBps", type: "uint16[]" },
    { name: "salt", type: "bytes32" },
  ],
} as const;

export const COMMIT_AUTH_TYPES = {
  CommitAuthorization: [
    { name: "provider", type: "address" },
    { name: "commitHash", type: "bytes32" },
    { name: "market", type: "bytes32" },
    { name: "validUntil", type: "uint64" },
    { name: "pricePerSub", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

export const SIGNAL_TYPE_STRING =
  "Signal(address provider,bytes32 market,uint8 side,uint256 entry,uint256 takeProfit,uint256 stopLoss,uint64 validUntil,uint256 pricePerSub,uint256[] upstream,uint16[] upstreamBps,bytes32 salt)";
export const COMMIT_AUTH_TYPE_STRING =
  "CommitAuthorization(address provider,bytes32 commitHash,bytes32 market,uint64 validUntil,uint256 pricePerSub,uint256 nonce,uint64 deadline)";
