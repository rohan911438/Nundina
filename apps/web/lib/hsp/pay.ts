"use client";

import { encodeAbiParameters, erc20Abi, getAddress, keccak256, type Address, type Hex } from "viem";
import type { Config } from "wagmi";
import { signTypedData, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import type { Intent } from "@/lib/session";

/**
 * HSP evm-transfer: the buyer signs the payment mandate (EIP-712), then sends the ERC-20 transfer
 * to the escrow named in it. The API submits both to HSP and credits the escrow on ACCEPT.
 */
export async function payIntent(wagmi: Config, intent: Intent): Promise<{ mandateSig: Hex; txHash: Hex }> {
  const td = intent.mandateTypedData;
  if (!td) throw new Error("This payment uses the HSP checkout, not a wallet mandate");
  const m = td.message;
  const mandateSig = await signTypedData(wagmi, {
    domain: { ...td.domain, chainId: Number(td.domain.chainId) },
    types: td.types,
    primaryType: "Mandate",
    message: { ...m, amount: BigInt(m.amount), chainId: BigInt(m.chainId), deadline: BigInt(m.deadline) },
  });
  const txHash = await writeContract(wagmi, {
    address: getAddress(m.token),
    abi: erc20Abi,
    functionName: "transfer",
    args: [getAddress(m.payee), BigInt(m.amount)],
  });
  await waitForTransactionReceipt(wagmi, { hash: txHash, confirmations: 1 });
  return { mandateSig, txHash };
}

const AUTH_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/**
 * USDC.e fast path (EIP-3009): one gasless signature; the API relays `fundWithAuthorization`.
 * The nonce is bound to the signal and buyer, as the escrow requires.
 */
export async function signFastPath(
  wagmi: Config,
  p: { token: Address; tokenName: string; tokenVersion: string; chainId: number; from: Address; escrow: Address; value: bigint; signalId: bigint },
) {
  const nonce = keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }], [p.signalId, p.from]));
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 30 * 60);
  const authorization = { from: p.from, to: p.escrow, value: p.value, validAfter: 0n, validBefore, nonce };
  const signature = await signTypedData(wagmi, {
    domain: { name: p.tokenName, version: p.tokenVersion, chainId: p.chainId, verifyingContract: p.token },
    types: AUTH_TYPES,
    primaryType: "TransferWithAuthorization",
    message: authorization,
  });
  return {
    signature,
    authorization: {
      from: p.from,
      to: p.escrow,
      value: p.value.toString(),
      validAfter: "0",
      validBefore: validBefore.toString(),
      nonce,
    },
  };
}
