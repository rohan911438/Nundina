import { getAddress, parseEventLogs, type Address, type Hex } from "viem";
import { erc20Abi } from "@nundina/shared/abis";
import { publicClient } from "../chain/clients.js";
import type { OutcomeClass } from "./PaymentRail.js";

export interface ExpectedTransfer {
  token: Address;
  from: Address;
  to: Address;
  amount: bigint;
}

export interface ObservedTransfer {
  outcomeClass: OutcomeClass;
  reason?: string;
  blockNumber?: bigint;
  logIndex?: number;
  /** Tokens `from` sent to `to` in this tx (any amount); used to return rejected payments. */
  sentToPayee: bigint;
}

/**
 * Independently checks an ERC-20 settlement on-chain: the tx must be mined, succeed, and contain a
 * `Transfer(from → to, amount)` log emitted by `token`. Both rails run this; never trust a status flag.
 */
export async function observeTransfer(txHash: Hex, exp: ExpectedTransfer): Promise<ObservedTransfer> {
  const receipt = await publicClient()
    .getTransactionReceipt({ hash: txHash })
    .catch(() => null);
  if (!receipt) return { outcomeClass: "RETRYABLE", reason: "transaction not mined yet", sentToPayee: 0n };
  if (receipt.status !== "success") return { outcomeClass: "PERMANENT", reason: "transaction reverted", sentToPayee: 0n };

  const transfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs }).filter(
    (l) => getAddress(l.address) === getAddress(exp.token),
  );
  const fromPayer = transfers.filter((l) => getAddress(l.args.from) === getAddress(exp.from));
  const toPayee = fromPayer.filter((l) => getAddress(l.args.to) === getAddress(exp.to));
  const sentToPayee = toPayee.reduce((a, l) => a + l.args.value, 0n);

  const exact = toPayee.find((l) => l.args.value === exp.amount);
  if (exact) {
    return { outcomeClass: "ACCEPT", blockNumber: receipt.blockNumber, logIndex: exact.logIndex, sentToPayee };
  }
  if (toPayee.length) return { outcomeClass: "POLICY", reason: `amount ${sentToPayee} != ${exp.amount}`, sentToPayee };
  if (fromPayer.length) return { outcomeClass: "POLICY", reason: "transfer went to the wrong recipient", sentToPayee };
  return { outcomeClass: "POLICY", reason: "no matching token transfer from the payer", sentToPayee };
}
