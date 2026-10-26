import { describe, expect, it } from "vitest";
import { ago, explorer, hhmm, int, pct, pp, price, r, short, tone, usd, utc } from "@/lib/format";
import { equityPoints } from "@/lib/equity";
import { filterQuery, parseFilters } from "@/lib/leaderboard";
import { signalState } from "@/lib/signal-state";

describe("format", () => {
  it("money with 2 decimals; compact over 10k", () => {
    expect(usd("1.500000")).toBe("$1.50");
    expect(usd("1234.5")).toBe("$1,234.50");
    expect(usd("125000", { compact: true })).toBe("$125K");
    expect(usd(null)).toBe("$0.00");
  });

  it("prices in the market's display decimals", () => {
    expect(price("81500.12345678", "BTC/USD")).toBe("81,500.12");
    expect(price("0.08731234", "HSK/USD")).toBe("0.0873");
    expect(price(null)).toBe("—");
  });

  it("R multiples with a real minus sign", () => {
    expect(r(2.5)).toBe("+2.50R");
    expect(r(-1)).toBe("−1.00R");
    expect(r(0)).toBe("0.00R");
    expect(r(null)).toBe("—");
  });

  it("percentages: fractions vs percent points", () => {
    expect(pct(0.6342)).toBe("63.4%");
    expect(pct(0.05, { signed: true })).toBe("+5.0%");
    expect(pp(1.234)).toBe("+1.2%");
    expect(pp(-0.5)).toBe("−0.5%");
    expect(int(12345)).toBe("12,345");
    expect(tone(0)).toBe("muted");
    expect(tone(-1)).toBe("loss");
  });

  it("times in UTC and relative", () => {
    expect(utc("2026-10-26T14:05:00Z")).toBe("26 Oct 2026, 14:05 UTC");
    expect(hhmm("2026-10-26T09:07:00Z")).toBe("09:07 UTC");
    const now = Date.parse("2026-10-26T12:00:00Z");
    expect(ago("2026-10-26T09:00:00Z", now)).toBe("3 hr. ago");
    expect(ago("2026-10-26T12:05:00Z", now)).toBe("in 5 min.");
  });

  it("hashes shortened; explorer links for the configured chain", () => {
    expect(short("0x1234567890abcdef1234")).toBe("0x1234…1234");
    expect(explorer.tx("0xabc")).toBe("https://hsk.blockscout.com/tx/0xabc");
    expect(explorer.address("0xdef", 177)).toBe("https://hsk.blockscout.com/address/0xdef");
    expect(explorer.hsp("pay_1")).toBe("https://hsp.test/payments/pay_1");
  });
});

describe("signal state", () => {
  const base = { status: "COMMITTED", outcome: null, revealed: false };
  it.each([
    [base, "locked"],
    [{ ...base, revealed: true }, "live"],
    [{ status: "SETTLED", outcome: "WIN", revealed: true }, "win"],
    [{ status: "REFUNDED", outcome: "LOSS", revealed: true }, "loss"],
    [{ status: "UNREVEALED_LOSS", outcome: "LOSS", revealed: false }, "unrevealed"],
    [{ status: "SETTLED", outcome: "VOID", revealed: true }, "void"],
    [{ status: "REFUNDED", outcome: null, revealed: false }, "refunded"],
    [{ status: "RESOLVED", outcome: null, revealed: true }, "resolving"],
  ] as const)("%o → %s", (s, want) => expect(signalState(s)).toBe(want));
});

describe("equity curve", () => {
  it("cumulates R by decision time, unrevealed = −1R, unique times", () => {
    const pts = equityPoints([
      { decidedAt: "2026-10-02T00:00:00Z", rMultiple: -1, outcome: "LOSS", status: "SETTLED" },
      { decidedAt: "2026-10-01T00:00:00Z", rMultiple: 2, outcome: "WIN", status: "SETTLED" },
      { decidedAt: "2026-10-02T00:00:00Z", rMultiple: null, outcome: "LOSS", status: "UNREVEALED_LOSS" },
      { decidedAt: null, rMultiple: null, outcome: null, status: "COMMITTED" },
    ]);
    expect(pts.map((p) => p.value)).toEqual([2, 1, 0]);
    expect(pts[2]!.time).toBe(pts[1]!.time + 1);
  });
});

describe("leaderboard filters", () => {
  it("parses the URL and drops unknown values", () => {
    expect(parseFilters({ market: "BTC/USD", period: "7d", type: "agent", verified: "1", sort: "alpha" })).toMatchObject({
      market: "BTC/USD",
      period: "7d",
      type: "agent",
      verified: true,
      observed: false,
      sort: "alpha",
    });
    expect(parseFilters({ market: "DOGE", period: "1y", sort: "x" })).toMatchObject({ market: undefined, period: "30d", sort: "score" });
  });
  it("writes short queries (defaults omitted)", () => {
    expect(filterQuery({ period: "30d", sort: "score" })).toBe("");
    expect(filterQuery({ period: "all", verified: true, market: "HSK/USD" })).toBe("?market=HSK%2FUSD&period=all&verified=1");
  });
});
