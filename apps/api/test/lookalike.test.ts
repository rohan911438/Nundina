import { describe, expect, it } from "vitest";
import { lookalikeOf, looksAlike, skeleton } from "../src/services/lookalike.js";

describe("lookalike channel names", () => {
  it("folds the usual disguises to one skeleton", () => {
    expect(skeleton("Crypt0_King OFFICIAL")).toBe(skeleton("CryptoKing"));
    expect(skeleton("@WhaIe Alerts")).toBe(skeleton("Whale Alerts"));
    expect(skeleton("Bitcoin Signals VIP")).toBe(skeleton("bitcoin"));
    expect(skeleton("modern")).toBe(skeleton("rnodern"));
    expect(skeleton("prov_1793177420843_5")).toBe("provs");
    expect(skeleton("The Weather Desk")).toBe("weatherdesk"); // "the" goes, "weather" stays
    expect(skeleton("CryptoKingOfficial")).toBe(skeleton("CryptoKing"));
  });

  it("flags impersonations", () => {
    expect(looksAlike("Saffr0n Whale OFFICIAL", "Saffron Whale")).toBe(true);
    expect(looksAlike("saffronwhale_vip", "saffronwhale")).toBe(true);
    expect(looksAlike("Wolf Of Crypto", "Wolf 0f Cryptoo")).toBe(true); // one extra letter
    expect(looksAlike("Real CryptoKing Team", "cryptoking")).toBe(true);
  });

  it("leaves different names alone", () => {
    expect(looksAlike("Alpha Calls", "Beta Calls")).toBe(false);
    expect(looksAlike("Zephyr Quant", "Saffron Whale")).toBe(false);
    expect(looksAlike("BTC", "ETH")).toBe(false);
    expect(looksAlike("abc", "abd")).toBe(false); // too short to judge, only exact
    expect(looksAlike("trader_2024", "trader_1999")).toBe(true); // same name, different year
    expect(looksAlike("", "")).toBe(false);
  });

  it("names the first established provider resembled", () => {
    const established = [
      { handle: "zephyr", names: ["Zephyr Quant", "zephyrquant"] },
      { handle: "saffron", names: ["Saffron Whale", null] },
    ];
    expect(lookalikeOf(["Saffr0n Whale", "fresh_1"], established)).toBe("saffron");
    expect(lookalikeOf(["Kestrel Flow", undefined], established)).toBeNull();
  });
});
