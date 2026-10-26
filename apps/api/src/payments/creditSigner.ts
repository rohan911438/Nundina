import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "../env.js";
import { addr } from "../chain/clients.js";
import { ApiError } from "../lib/errors.js";

/** EIP-712 types of contracts/src/lib/ReceiptLib.sol, domain of SignerCreditVerifier. */
export const CREDIT_TYPES = {
  Credit: [
    { name: "signalId", type: "uint256" },
    { name: "subscriber", type: "address" },
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "receiptHash", type: "bytes32" },
    { name: "txHash", type: "bytes32" },
  ],
} as const;

export const RECOVER_TYPES = {
  Recover: [
    { name: "token", type: "address" },
    { name: "payer", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "txHash", type: "bytes32" },
  ],
} as const;

function signer() {
  const pk = env().CREDIT_SIGNER_PRIVATE_KEY;
  if (!pk) throw new ApiError(503, "credit_signer_unconfigured", "CREDIT_SIGNER_PRIVATE_KEY is not set");
  return privateKeyToAccount(pk as Hex);
}

const domain = () => ({
  name: "NundinaEscrow",
  version: "1",
  chainId: env().CHAIN_ID,
  verifyingContract: addr("SignerCreditVerifier"),
});

/** Signs only after the rail verified the payment (ACCEPT). */
export function signCredit(m: {
  signalId: bigint;
  subscriber: Address;
  token: Address;
  amount: bigint;
  receiptHash: Hex;
  txHash: Hex;
}): Promise<Hex> {
  return signer().signTypedData({ domain: domain(), types: CREDIT_TYPES, primaryType: "Credit", message: m });
}

/** Authorises returning an uncredited transfer to its original payer. */
export function signRecover(m: { token: Address; payer: Address; amount: bigint; txHash: Hex }): Promise<Hex> {
  return signer().signTypedData({ domain: domain(), types: RECOVER_TYPES, primaryType: "Recover", message: m });
}
