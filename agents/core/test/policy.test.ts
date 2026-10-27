import { describe, expect, it } from "vitest";
import { MAX_DAILY_SPEND, decide, spentToday, type AgentState, type Candidate, type Policy } from "../src/policy.js";
import { guard } from "../src/pay.js";
import { spendGuard, unitPolicy } from "../src/execution.js";

const now = new Date("2026-10-27T12:00:00Z");
const base: Candidate = { signalId: "7", market: "BTC/USD", price: 300_000n, providerHandle: "alpha", providerScore: 72, capacity: 5n };
const state = (o: Partial<AgentState> = {}): AgentState => ({ paused: false, spentToday: 0n, spentDay: "2026-10-27", bought: new Set(), ...o });
const policy: Policy = { dailyBudget: "1000000", maxPerSignal: "500000", minScore: 60, markets: ["BTC/USD"] };

describe("decide", () => {
  const cases: [string, Policy, AgentState, Candidate, boolean, RegExp][] = [
    ["buys within every rule", policy, state(), base, true, /score 72/],
    ["paused", policy, state({ paused: true }), base, false, /paused/],
    ["already bought", policy, state({ bought: new Set(["7"]) }), base, false, /already bought/],
    ["market not allowed", policy, state(), { ...base, market: "HSK/USD" }, false, /market HSK\/USD/],
    ["deny list (case-insensitive)", { ...policy, providersDeny: ["ALPHA"] }, state(), base, false, /deny list/],
    ["not on allow list", { ...policy, providersAllow: ["beta"] }, state(), base, false, /allow list/],
    ["on allow list", { ...policy, providersAllow: ["alpha"] }, state(), base, true, /score/],
    ["probation fails a min score", policy, state(), { ...base, providerScore: null }, false, /probation/],
    ["probation ok without a min score", { ...policy, minScore: 0 }, state(), { ...base, providerScore: null }, true, /score —/],
    ["score below min", policy, state(), { ...base, providerScore: 59 }, false, /score 59 < 60/],
    ["price over per-signal cap", policy, state(), { ...base, price: 500_001n }, false, /cap/],
    ["price at cap", policy, state(), { ...base, price: 500_000n }, true, /score/],
    ["daily budget exceeded", policy, state({ spentToday: 800_000n }), base, false, /daily budget/],
    ["daily budget exactly met", policy, state({ spentToday: 700_000n }), base, true, /\$1\.00 of \$1\.00/],
    ["hard cap", { minScore: 0 }, state({ spentToday: MAX_DAILY_SPEND }), base, false, /hard cap/],
    ["no capacity", policy, state(), { ...base, capacity: 0n }, false, /capacity/],
    ["unknown capacity passes", policy, state(), { ...base, capacity: null }, true, /score/],
  ];
  it.each(cases)("%s", (_n, p, s, c, buy, reason) => {
    const d = decide(p, s, c, now);
    expect(d.buy).toBe(buy);
    expect(d.reason).toMatch(reason);
  });

  it("budget rolls over at UTC midnight", () => {
    const s = state({ spentToday: 1_000_000n, spentDay: "2026-10-27" });
    const before = new Date("2026-10-27T23:59:59Z");
    const after = new Date("2026-10-28T00:00:00Z");
    expect(spentToday(s, before)).toBe(1_000_000n);
    expect(decide(policy, s, base, before).buy).toBe(false);
    expect(spentToday(s, after)).toBe(0n);
    expect(decide(policy, s, base, after).buy).toBe(true);
  });

  it("rollover follows UTC, not local time", () => {
    // 23:30 UTC on the 27th is already the 28th in UTC+5:30; still the 27th in UTC
    const s = state({ spentToday: 1_000_000n, spentDay: "2026-10-27" });
    expect(spentToday(s, new Date("2026-10-28T05:00:00+05:30"))).toBe(1_000_000n);
  });
});

describe("SpendGuard", () => {
  const escrow = "0x00000000000000000000000000000000000000E5";
  const g = { perTxCap: 500_000n, dailyCap: 1_000_000n, spentToday: 600_000n, recipients: [escrow] };
  it("allows the escrow within caps", () => expect(guard(g, escrow.toLowerCase(), 400_000n)).toBeNull());
  it("blocks other recipients", () => expect(guard(g, "0x0000000000000000000000000000000000000001", 1n)).toMatch(/recipient/));
  it("blocks over per-tx", () => expect(guard(g, escrow, 500_001n)).toMatch(/per-tx/));
  it("blocks over daily", () => expect(guard(g, escrow, 400_001n)).toMatch(/daily/));

  it("is built from the same policy, never above the hard cap", () => {
    process.env.INTERNAL_SECRET ??= "test-internal-secret-0123456789";
    const p = unitPolicy({ dailyBudgetUsd: "100", maxPerSignalUsd: "0.5", minScore: 50, markets: [], providersAllow: [], providersDeny: [], autoTrade: false, slippageBps: 50 });
    const sg = spendGuard(p, 0n);
    expect(sg.perTxCap).toBe(500_000n);
    expect(sg.dailyCap).toBe(MAX_DAILY_SPEND);
    expect(sg.recipients).toHaveLength(1);
  });
});
