/**
 * The keeper: takes every signal to a final on-chain outcome and settles it, with no human step.
 * Every action re-reads chain state first and is skipped if someone already did it, so the keeper
 * can crash and restart at any point (state is rebuilt from the API + chain on each sync).
 */
import type { Hex, PublicClient } from "viem";
import { marketById, type Signal } from "@nundina/shared";
import { outcomeResolverAbi, performanceEscrowAbi, signalBookAbi } from "@nundina/shared/abis";
import { chainNow, readConfig, readSignal, type Addresses, type OnchainSignal } from "./chain.js";
import { checkTick, ENTRY, SL, TP, type Level, type WatchedSignal } from "./detectors/touch.js";
import type { PriceHistory } from "./history.js";
import type { Metrics } from "./metrics.js";
import type { Oracle } from "./oracle/types.js";
import type { KeeperApi } from "./state.js";
import type { SendResult, TxSender } from "./tx.js";

/** Resolver's pending level for an expiry mark (OutcomeResolver.EXPIRY). */
const EXPIRY = 3;
/** Unsettled this long after expiry → anyone may refund everyone (PerformanceEscrow.claimRefund). */
export const REFUND_AFTER_S = 24 * 3600;
/** How long to keep asking the oracle for a proof that backs an exchange-feed crossing. */
export const PROOF_RETRY_MS = 2 * 60_000;
const PROOF_RETRY_EVERY_MS = 10_000;

interface Tracked {
  id: bigint;
  label: string;
  chain: OnchainSignal;
  /** Plaintext; null when the API has no material and the signal isn't revealed on-chain. */
  s: Signal | null;
}

export type Log = (level: "info" | "warn" | "error", msg: string, extra?: object) => void;

export class Keeper {
  readonly signals = new Map<string, Tracked>();
  private readonly inflight = new Set<string>();
  private config: { touchProofsEnabled: boolean; challengeWindow: number; revealWindow: number } | null = null;
  private now = 0;

  constructor(
    private readonly pub: PublicClient,
    private readonly a: Addresses,
    private readonly api: KeeperApi,
    private readonly tx: TxSender,
    private readonly oracle: Oracle,
    private readonly history: PriceHistory,
    readonly metrics: Metrics,
    private readonly log: Log,
    private readonly opts: { proofRetryMs?: number } = {},
  ) {}

  get touchProofsEnabled() {
    return this.config?.touchProofsEnabled ?? false;
  }

  // ───────────────────────── state ─────────────────────────

  /** Rebuilds the working set from the API's candidates and the chain. */
  async sync() {
    this.config ??= await this.tx.rpc(() => readConfig(this.pub, this.a));
    this.now = await this.tx.rpc(() => chainNow(this.pub));
    const cands = await this.api.candidates();
    const seen = new Set<string>();
    for (const c of cands) {
      seen.add(c.id);
      const id = BigInt(c.id);
      const chain = await this.tx.rpc(() => readSignal(this.pub, this.a, id));
      if (chain.status === "NONE" || chain.pot !== "OPEN") {
        this.signals.delete(c.id);
        continue;
      }
      const prev = this.signals.get(c.id);
      let s = prev?.s ?? null;
      if (!s && chain.status === "REVEALED") {
        s = (await this.tx.rpc(() => this.pub.readContract({ address: this.a.book, abi: signalBookAbi, functionName: "revealedSignal", args: [id] }))) as Signal;
      }
      if (!s && c.hasMaterial) s = await this.api.material(c.id);
      this.signals.set(c.id, { id, label: marketById(chain.market)?.label ?? c.market, chain, s });
    }
    for (const k of this.signals.keys()) if (!seen.has(k)) this.signals.delete(k);
  }

  private async refreshOne(t: Tracked) {
    t.chain = await this.tx.rpc(() => readSignal(this.pub, this.a, t.id));
  }

  private watched(t: Tracked): WatchedSignal | null {
    if (!t.s) return null;
    return {
      id: t.id,
      s: t.s,
      isLimit: t.chain.isLimit,
      oraclePriceAtCommit: t.chain.oraclePriceAtCommit,
      committedAt: t.chain.committedAt,
      validUntil: t.chain.validUntil,
      entryTouchedAt: t.chain.resolver.entryTouchedAt,
    };
  }

  private async act(name: string, id: bigint, fn: () => Promise<SendResult>) {
    const r = await fn();
    if (r.status === "sent") this.metrics.count(name);
    else this.log("info", `${name} skipped`, { id: id.toString(), reason: r.reason });
    return r;
  }

  // ───────────────────────── 1. touch watcher (real time) ─────────────────────────

  /** One exchange trade. Records history; on a crossing, proves the touch on-chain. */
  onTrade(market: string, price: bigint, ts: number) {
    this.history.add(market, price, ts);
    if (!this.touchProofsEnabled) return;
    for (const t of this.signals.values()) {
      if (t.label !== market || t.chain.resolver.final) continue;
      const w = this.watched(t);
      if (!w) continue;
      const level = checkTick(w, price, ts);
      if (level == null || !this.worthProving(t, level, ts)) continue;
      void this.metrics.run("touch", () => this.prove(t, level, { price, ts }));
    }
  }

  /** Skip if this level is already proven, or an earlier touch is already pending. */
  private worthProving(t: Tracked, level: Level, ts: number) {
    const r = t.chain.resolver;
    if (level === ENTRY) return r.entryTouchedAt === 0;
    if (r.pendingTs !== 0 && r.pendingLevel !== EXPIRY && r.pendingTs <= ts) return false;
    return true;
  }

  /** Gets an oracle proof backing the crossing (retrying up to 2 min) and sends proveTouch. */
  async prove(t: Tracked, level: Level, observed: { price: bigint; ts: number }) {
    const key = `${t.id}:${level}`;
    if (this.inflight.has(key) || !t.s) return;
    this.inflight.add(key);
    try {
      const deadline = Date.now() + (this.opts.proofRetryMs ?? PROOF_RETRY_MS);
      const w = this.watched(t)!;
      for (;;) {
        const p = await this.oracle.touchProof(w, level, observed);
        if (p) {
          const r = await this.act("proveTouch", t.id, () =>
            this.tx.send({
              address: this.a.resolver,
              abi: outcomeResolverAbi,
              functionName: "proveTouch",
              args: [t.id, t.s!, level, p.proof],
              label: `proveTouch ${t.id} level ${level}`,
            }),
          );
          await this.refreshOne(t);
          return r;
        }
        if (Date.now() > deadline) {
          this.log("info", "no proof-backed crossing; dropped", { id: t.id.toString(), level });
          return;
        }
        await new Promise((r) => setTimeout(r, PROOF_RETRY_EVERY_MS));
      }
    } finally {
      this.inflight.delete(key);
    }
  }

  // ───────────────────────── 7. challenge watcher ─────────────────────────

  /**
   * While a touch (or expiry mark) is pending, look for an earlier touch of the other level in our
   * price history and prove it: earliest touch wins on-chain. Also catches touches missed while the
   * keeper was down (history is backfilled from exchange candles on start).
   */
  async challenges() {
    if (!this.touchProofsEnabled || !this.oracle.canProveHistory) return;
    for (const t of this.signals.values()) {
      const r = t.chain.resolver;
      const w = this.watched(t);
      if (!w || r.final || r.pendingTs === 0) continue;
      if (this.now >= r.pendingAt + this.config!.challengeWindow) continue; // too late, finalize instead
      const others: Level[] = r.pendingLevel === TP ? [SL] : r.pendingLevel === SL ? [TP] : [SL, TP];
      const from = w.isLimit ? w.entryTouchedAt + 1 : w.committedAt;
      let best: { level: Level; price: bigint; ts: number } | null = null;
      for (const lvl of others) {
        const hit = this.history.firstTouch(t.label, w, from, r.pendingTs - 1, lvl);
        if (hit && (!best || hit.ts < best.ts)) best = hit;
      }
      if (best) {
        this.log("info", "earlier touch found; challenging", { id: t.id.toString(), level: best.level, ts: best.ts, pendingTs: r.pendingTs });
        await this.prove(t, best.level, { price: best.price, ts: best.ts });
        this.metrics.count("challenge");
      }
    }
  }

  // ───────────────────────── 2. finalizer ─────────────────────────

  async finalizer() {
    for (const t of this.signals.values()) {
      const r = t.chain.resolver;
      if (r.final || r.pendingTs === 0 || this.now < r.pendingAt + this.config!.challengeWindow) continue;
      await this.act("finalize", t.id, () =>
        this.tx.send({ address: this.a.resolver, abi: outcomeResolverAbi, functionName: "finalize", args: [t.id], label: `finalize ${t.id}` }),
      );
      await this.refreshOne(t);
    }
  }

  // ───────────────────────── 3. expiry resolver ─────────────────────────

  async expiry() {
    for (const t of this.signals.values()) {
      const c = t.chain;
      if (c.resolver.final || c.resolver.pendingTs !== 0 || this.now <= c.validUntil || c.status === "UNREVEALED_LOSS" || !t.s) continue;
      const w = this.watched(t)!;
      // catch-up: a touch we missed (keeper down) beats marking to market, if we can still prove it
      if (this.touchProofsEnabled && this.oracle.canProveHistory) {
        const missed = this.history.firstTouch(t.label, w, w.committedAt, c.validUntil);
        if (missed && this.worthProving(t, missed.level, missed.ts)) {
          this.log("info", "touch missed while down; proving before expiry", { id: t.id.toString(), level: missed.level });
          await this.prove(t, missed.level, { price: missed.price, ts: missed.ts });
          if (t.chain.resolver.pendingTs !== 0 || missed.level === ENTRY) continue;
        }
      }
      const options = await this.oracle.expiryArgs(c.market as Hex, c.validUntil, this.now);
      for (const o of options) {
        const r = await this.act("resolveAtExpiry", t.id, () =>
          o.kind === "hint"
            ? this.tx.send({ address: this.a.resolver, abi: outcomeResolverAbi, functionName: "resolveAtExpiry", args: [t.id, t.s!, o.hint], label: `resolveAtExpiry ${t.id}` })
            : this.tx.send({ address: this.a.resolver, abi: outcomeResolverAbi, functionName: "resolveAtExpiryWithProof", args: [t.id, t.s!, o.proof], label: `resolveAtExpiryWithProof ${t.id}` }),
        );
        if (r.status === "sent") break;
      }
      await this.refreshOne(t);
    }
  }

  // ───────────────────────── 4. settler ─────────────────────────

  async settler() {
    for (const t of this.signals.values()) {
      const c = t.chain;
      if (!c.outcomeFinal || c.outcome === "NONE" || c.pot !== "OPEN") continue;
      await this.act("settle", t.id, () =>
        this.tx.send({ address: this.a.escrow, abi: performanceEscrowAbi, functionName: "settle", args: [t.id], label: `settle ${t.id}` }),
      );
      await this.refreshOne(t);
    }
  }

  // ───────────────────────── 5. unrevealed sweep ─────────────────────────

  async unrevealed() {
    for (const t of this.signals.values()) {
      const c = t.chain;
      if (c.status !== "COMMITTED" || this.now <= c.validUntil + this.config!.revealWindow) continue;
      const r = await this.act("markUnrevealed", t.id, () =>
        this.tx.send({ address: this.a.book, abi: signalBookAbi, functionName: "markUnrevealed", args: [t.id], label: `markUnrevealed ${t.id}` }),
      );
      await this.refreshOne(t);
      if (r.status === "sent") await this.settler();
    }
  }

  // ───────────────────────── 6. refund sweep ─────────────────────────

  async refunds() {
    for (const t of this.signals.values()) {
      const c = t.chain;
      if (c.pot !== "OPEN" || c.outcomeFinal || this.now <= c.validUntil + REFUND_AFTER_S) continue;
      await this.act("claimRefund", t.id, () =>
        this.tx.send({ address: this.a.escrow, abi: performanceEscrowAbi, functionName: "claimRefund", args: [t.id], label: `claimRefund ${t.id}` }),
      );
      await this.refreshOne(t);
    }
  }

  /** One full pass of every periodic loop (tests and catch-up after a restart). */
  async runAll() {
    await this.metrics.run("sync", () => this.sync());
    await this.metrics.run("push", () => this.oracle.tick?.(this.now) ?? Promise.resolve());
    await this.metrics.run("challenge", () => this.challenges());
    await this.metrics.run("finalizer", () => this.finalizer());
    await this.metrics.run("expiry", () => this.expiry());
    await this.metrics.run("unrevealed", () => this.unrevealed());
    await this.metrics.run("settler", () => this.settler());
    await this.metrics.run("refund", () => this.refunds());
  }
}
