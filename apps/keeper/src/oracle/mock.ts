/**
 * MockPriceAdapter oracle (local anvil and testnet only). The keeper holds UPDATER_ROLE: it pushes
 * exchange prices as rounds (so `spotPrice` and expiry pricing work) and posts the touches it
 * proves. Mainnet never uses this.
 */
import { encodeAbiParameters, type Address, type Hex, type PublicClient } from "viem";
import { MARKETS } from "@nundina/shared";
import { mockPriceAdapterAbi } from "@nundina/shared/abis";
import type { Level, WatchedSignal } from "../detectors/touch.js";
import type { PriceHistory } from "../history.js";
import type { TxSender } from "../tx.js";
import type { ExpiryArgs, Oracle, TouchProof } from "./types.js";

export class MockOracle implements Oracle {
  readonly kind = "mock" as const;
  readonly canProveHistory = true;
  private lastPushTs = new Map<string, number>();

  constructor(
    private readonly pub: PublicClient,
    private readonly tx: TxSender,
    private readonly adapter: Address,
    private readonly history: PriceHistory,
    private readonly pushIntervalS: number,
  ) {}

  async touchProof(w: WatchedSignal, _level: Level, observed: { price: bigint; ts: number }): Promise<TouchProof | null> {
    const market = w.s.market;
    const r = await this.tx.send({
      address: this.adapter,
      abi: mockPriceAdapterAbi,
      functionName: "postTouch",
      args: [market, observed.price, BigInt(observed.ts)],
      label: `postTouch ${w.id}`,
    });
    if (r.status === "skipped") return null;
    const proof = encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }, { type: "uint64" }], [market, observed.price, BigInt(observed.ts)]);
    return { proof, price: observed.price, ts: observed.ts };
  }

  /** Round id hint: the last round with ts <= validUntil (binary search over `roundAt`). */
  async expiryArgs(market: Hex, validUntil: number): Promise<ExpiryArgs[]> {
    const count = Number(await this.pub.readContract({ address: this.adapter, abi: mockPriceAdapterAbi, functionName: "roundCount", args: [market] }));
    let lo = 0;
    let hi = count - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const [, ts] = await this.pub.readContract({ address: this.adapter, abi: mockPriceAdapterAbi, functionName: "roundAt", args: [market, BigInt(mid)] });
      if (Number(ts) <= validUntil) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found < 0 ? [] : [{ kind: "hint", hint: BigInt(found) }];
  }

  /** Pushes the latest exchange price of each market as a new round every `pushIntervalS`. */
  async tick() {
    for (const m of Object.values(MARKETS)) {
      const latest = this.history.latest(m.label);
      if (!latest) continue;
      const last = this.lastPushTs.get(m.label) ?? 0;
      if (latest.ts - last < this.pushIntervalS) continue;
      const r = await this.tx.send({
        address: this.adapter,
        abi: mockPriceAdapterAbi,
        functionName: "push",
        args: [m.id, latest.price, BigInt(latest.ts)],
        label: `push ${m.label}`,
      });
      if (r.status === "sent") this.lastPushTs.set(m.label, latest.ts);
    }
  }
}
