/**
 * Keeper transactions: simulate first (a revert means someone else already did it, or it's not
 * time yet), cap the fee, retry RPC errors with backoff, and trip a circuit breaker when the RPC
 * has been unreachable for 2 minutes.
 */
import {
  BaseError,
  ContractFunctionRevertedError,
  parseGwei,
  type Abi,
  type Account,
  type Address,
  type Chain,
  type Hash,
  type PublicClient,
  type WalletClient,
} from "viem";

export const CIRCUIT_OPEN_AFTER_MS = 2 * 60_000;

export interface Call {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  /** For logs only. */
  label: string;
}

export type SendResult = { status: "sent"; hash: Hash } | { status: "skipped"; reason: string };

export class CircuitOpenError extends Error {}

export class TxSender {
  rpcDownSince: number | null = null;
  sent = 0;

  constructor(
    private readonly pub: PublicClient,
    private readonly wallet: WalletClient<any, Chain, Account>,
    private readonly maxGwei: number,
    private readonly log: (level: "info" | "warn" | "error", msg: string, extra?: object) => void,
  ) {}

  get circuitOpen() {
    return this.rpcDownSince != null && Date.now() - this.rpcDownSince > CIRCUIT_OPEN_AFTER_MS;
  }

  /** Runs an RPC call with exponential backoff; marks the RPC down/up for the circuit breaker. */
  async rpc<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
    if (this.circuitOpen) {
      // probe once; stay open on failure
      try {
        const v = await fn();
        this.rpcDownSince = null;
        return v;
      } catch (e) {
        throw new CircuitOpenError(`RPC down since ${new Date(this.rpcDownSince!).toISOString()}: ${(e as Error).message}`);
      }
    }
    let delay = 500;
    for (let i = 0; ; i++) {
      try {
        const v = await fn();
        this.rpcDownSince = null;
        return v;
      } catch (e) {
        if (!isTransport(e) || i >= attempts - 1) {
          if (isTransport(e)) this.rpcDownSince ??= Date.now();
          throw e;
        }
        await new Promise((r) => setTimeout(r, delay));
        delay *= 2;
      }
    }
  }

  async send(call: Call): Promise<SendResult> {
    try {
      const { request } = await this.rpc(() =>
        this.pub.simulateContract({ address: call.address, abi: call.abi, functionName: call.functionName, args: call.args as any, account: this.wallet.account }),
      );
      const fees = await this.rpc(() => this.pub.estimateFeesPerGas());
      const cap = parseGwei(String(this.maxGwei));
      const maxFeePerGas = fees.maxFeePerGas && fees.maxFeePerGas > cap ? cap : fees.maxFeePerGas;
      const hash = await this.rpc(() =>
        this.wallet.writeContract({ ...(request as any), maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas && maxFeePerGas && fees.maxPriorityFeePerGas > maxFeePerGas ? maxFeePerGas : fees.maxPriorityFeePerGas }),
      );
      const receipt = await this.rpc(() => this.pub.waitForTransactionReceipt({ hash, timeout: 120_000 }));
      if (receipt.status !== "success") return { status: "skipped", reason: `reverted on-chain (${hash})` };
      this.sent++;
      this.log("info", "tx", { label: call.label, hash });
      return { status: "sent", hash };
    } catch (e) {
      const reason = revertReason(e);
      if (reason) return { status: "skipped", reason };
      throw e;
    }
  }
}

function isTransport(e: unknown) {
  const name = (e as Error)?.name ?? "";
  const msg = String((e as Error)?.message ?? "");
  return /HttpRequestError|TimeoutError|WebSocketRequestError|SocketClosedError/.test(name) || /fetch failed|ECONNREFUSED|ECONNRESET|socket hang up/i.test(msg);
}

/** The custom error name for a contract revert, or null for anything else. */
export function revertReason(e: unknown): string | null {
  if (!(e instanceof BaseError)) return null;
  const revert = e.walk((err) => err instanceof ContractFunctionRevertedError);
  if (revert instanceof ContractFunctionRevertedError) return revert.data?.errorName ?? revert.reason ?? revert.shortMessage;
  return null;
}
