import { describe, expect, it, vi } from "vitest";
import { parseRules, parseSignal, type ParsedSignal } from "../src/parser/index.js";
import type { Extraction } from "../src/parser/llm.js";

type Expect = Partial<Omit<ParsedSignal, "notes">> | "not_signal" | "unsupported_market" | "incomplete" | "invalid";

/** 30 fixture posts: Cornix blocks, one-liners, Hinglish noise, and non-signals. */
const FIXTURES: [string, string, Expect][] = [
  ["cornix block", "#BTC/USDT LONG\nEntry: 81500 - 81200\nTargets: 82500 - 84000\nStop: 80200", { market: "BTC/USD", side: "LONG", entry: "81350", takeProfit: "82500", stopLoss: "80200", validHours: 24 }],
  ["cornix short", "#BTC/USDT SHORT\nEntry: 82000\nTargets: 80000 - 79000\nStop: 83000", { side: "SHORT", entry: "82000", takeProfit: "80000", stopLoss: "83000" }],
  ["one-liner k", "BTC LONG 81.5k TP 84k SL 80.2k 24h", { side: "LONG", entry: "81500", takeProfit: "84000", stopLoss: "80200", validHours: 24 }],
  ["one-liner short 12h", "BTC SHORT 82k TP 79.5k SL 83k 12h", { side: "SHORT", entry: "82000", takeProfit: "79500", stopLoss: "83000", validHours: 12 }],
  ["commas", "BTCUSDT Buy\nEntry 81,500\nTP 84,000\nSL 80,200", { side: "LONG", entry: "81500", takeProfit: "84000", stopLoss: "80200" }],
  ["numbered targets", "#BTC/USDT Long 📈\nEntry zone: 81200-81600\nTargets:\n1) 82500\n2) 83500\n3) 85000\nStop loss: 80400", { entry: "81400", takeProfit: "82500", stopLoss: "80400" }],
  ["tp1 tp2", "BTC long @ 81500\nTP1: 83000\nTP2: 84500\nSL: 80700", { entry: "81500", takeProfit: "83000", stopLoss: "80700" }],
  ["emoji heavy", "🚀🚀 BTC LONG 🚀🚀\n🎯 Entry: 81500\n✅ Target: 84000\n❌ Stop: 80200", { entry: "81500", takeProfit: "84000", stopLoss: "80200" }],
  ["leverage noise", "BTC/USDT 10x LONG\nEntry: 81500\nTargets: 84000\nStop: 80200\nLeverage: 10x cross", { entry: "81500", takeProfit: "84000", stopLoss: "80200" }],
  ["days validity", "BTC LONG 81500 TP 86000 SL 79500 valid 2 days", { validHours: 48 }],
  ["hinglish long", "Bhai BTC long le lo 81.5k pe, TP 84k, SL 80.2k, 24 hrs", { side: "LONG", entry: "81500", takeProfit: "84000", stopLoss: "80200", validHours: 24 }],
  ["hinglish short", "BTC short karo 82000 se, target 80000, stop 83000 rakhna", { side: "SHORT", entry: "82000", takeProfit: "80000", stopLoss: "83000" }],
  ["take profit words", "Bitcoin buy at 81500, take profit 84000, stop loss 80200", { entry: "81500", takeProfit: "84000", stopLoss: "80200" }],
  ["hsk", "#HSK/USDT LONG\nEntry: 0.52\nTarget: 0.58\nStop: 0.49", { market: "HSK/USD", entry: "0.52", takeProfit: "0.58", stopLoss: "0.49" }],
  ["hsk short decimals", "HSK SHORT 0.5450 TP 0.5100 SL 0.5620 6h", { market: "HSK/USD", side: "SHORT", entry: "0.545", takeProfit: "0.51", stopLoss: "0.562", validHours: 6 }],
  ["xbt", "XBT long entry 81500 tp 84000 sl 80200", { market: "BTC/USD", entry: "81500" }],
  ["markdown", "*BTC/USDT* — **LONG**\n_Entry_: 81500\n_TP_: 84000\n_SL_: 80200", { entry: "81500", takeProfit: "84000", stopLoss: "80200" }],
  ["lowercase tight", "btc long 81500 tp 84000 sl 80200", { entry: "81500" }],
  ["eth unsupported", "#ETH/USDT LONG\nEntry: 3200\nTarget: 3400\nStop: 3100", "unsupported_market"],
  ["sol unsupported", "SOLUSDT short 180 tp 165 sl 186", "unsupported_market"],
  ["doge unsupported", "DOGE long 0.15 tp 0.18 sl 0.14", "unsupported_market"],
  ["missing stop", "BTC LONG 81500 TP 84000", "incomplete"],
  ["missing entry", "#BTC/USDT LONG\nTargets: 84000\nStop: 80200", "incomplete"],
  ["bad geometry", "BTC LONG 81500 TP 80000 SL 82000", "invalid"],
  ["bad r:r", "BTC LONG 81500 TP 82000 SL 80000", "invalid"],
  ["too long validity", "BTC LONG 81500 TP 84000 SL 80200 30 days", "invalid"],
  ["commentary", "BTC looking strong today, might go long soon 👀", "not_signal"],
  ["result post", "Previous BTC call hit target! +12% 🔥", "not_signal"],
  ["question", "Should I buy BTC now or wait?", "not_signal"],
  ["chit chat", "Good morning family, markets open soon", "not_signal"],
];

describe("parser (rules)", () => {
  it.each(FIXTURES)("%s", async (_name, text, expected) => {
    const r = await parseSignal(text);
    if (typeof expected === "string") {
      expect(r.ok ? "ok" : r.reason).toBe(expected);
    } else {
      expect(r.ok, r.ok ? "" : `${r.reason}: ${r.detail}`).toBe(true);
      if (r.ok) expect(r.signal).toMatchObject(expected);
    }
  });

  it("says when the first of several targets is used", () => {
    const r = parseRules(FIXTURES[0]![1]);
    expect(r.ok && r.signal.notes.join(" ")).toMatch(/first \(82500\) is the take profit/);
  });
});

describe("parser (LLM fallback)", () => {
  const good: Extraction = { market: "BTC/USD", side: "LONG", entry: 81500, takeProfit: 84000, stopLoss: 80200, validHours: null, confidence: 0.92 };

  it("is used only when rules fail on a post that looks like a signal", async () => {
    const llm = vi.fn(async () => good);
    await parseSignal("BTC LONG 81.5k TP 84k SL 80.2k", { llm });
    expect(llm).not.toHaveBeenCalled(); // rules handled it
    await parseSignal("Good morning family", { llm });
    expect(llm).not.toHaveBeenCalled(); // no ticker + side
    const r = await parseSignal("BTC long now, price 81.5k, aim for 84k, cut below 80.2k", { llm });
    expect(llm).toHaveBeenCalledOnce();
    expect(r).toMatchObject({ ok: true, parser: "llm", signal: { entry: "81500", takeProfit: "84000", stopLoss: "80200", validHours: 24 } });
  });

  it("rejects low confidence", async () => {
    const r = await parseSignal("BTC looking strong, might go long", { llm: async () => ({ ...good, confidence: 0.5 }) });
    expect(r).toMatchObject({ ok: false, reason: "not_signal" });
  });

  it("still validates LLM output", async () => {
    const r = await parseSignal("BTC long now 81.5k", { llm: async () => ({ ...good, takeProfit: 82000, stopLoss: 80000 }) });
    expect(r).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("falls back to the rules' answer on timeout", async () => {
    const r = await parseSignal("BTC LONG 81500 TP 84000", { llm: async () => Promise.reject(new Error("timeout")) });
    expect(r).toMatchObject({ ok: false, reason: "incomplete" });
  });
});
