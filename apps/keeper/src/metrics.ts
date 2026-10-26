/** Counters and last-run timestamps for /health. */
export const LOOPS = ["sync", "touch", "challenge", "finalizer", "expiry", "settler", "unrevealed", "refund", "push"] as const;
export type LoopName = (typeof LOOPS)[number];

interface LoopStats {
  runs: number;
  lastRun: string | null;
  lastOk: string | null;
  lastError: string | null;
}

export class Metrics {
  readonly loops = Object.fromEntries(LOOPS.map((l) => [l, { runs: 0, lastRun: null, lastOk: null, lastError: null }])) as Record<LoopName, LoopStats>;
  readonly actions: Record<string, number> = {};
  balanceWei: bigint | null = null;

  async run<T>(loop: LoopName, fn: () => Promise<T>): Promise<T | undefined> {
    const s = this.loops[loop];
    s.runs++;
    s.lastRun = new Date().toISOString();
    try {
      const v = await fn();
      s.lastOk = s.lastRun;
      s.lastError = null;
      return v;
    } catch (e) {
      s.lastError = (e as Error).message.slice(0, 300);
      return undefined;
    }
  }

  count(action: string) {
    this.actions[action] = (this.actions[action] ?? 0) + 1;
  }
}
