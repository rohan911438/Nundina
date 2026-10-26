import { describe, expect, it } from "vitest";
import type { PublicSignal, SignalNotify } from "../src/api.js";
import { buyCard, draftCard, lockedCard, resultCard, unlockedCard } from "../src/cards.js";
import { LINKS } from "./harness.js";

const NOW = Date.parse("2026-10-26T14:02:00Z");
const base: PublicSignal = {
  id: "42",
  provider: { handle: "alpha", displayName: "Alpha <Calls>", kind: "human" },
  market: "BTC/USD",
  status: "COMMITTED",
  outcome: null,
  rMultiple: null,
  revealed: false,
  side: null,
  priceUsd: "0.5",
  validUntil: "2026-10-27T14:02:00.000Z",
  committedAt: "2026-10-26T14:02:00.000Z",
  decidedAt: null,
  purchaseCount: 2,
  tx: { commit: `0x${"aa".repeat(32)}`, reveal: null, resolve: null },
};

function settled(over: Partial<PublicSignal>, settlement: Partial<NonNullable<SignalNotify["settlement"]>> = {}): SignalNotify {
  return {
    signal: { ...base, revealed: true, side: "LONG", tx: { ...base.tx, resolve: `0x${"cc".repeat(32)}` }, ...over, pricePerSub: "500000" },
    provider: { id: 1, handle: "alpha", displayName: "Alpha", channelId: -100, channelTitle: "Alpha Calls", telegramId: 1 },
    post: { chatId: -100, messageId: 7 },
    cardMessageId: 8,
    buyers: [],
    settlement: { outcome: "LOSS", payout: "0", refundsTotal: "1000000", slashTotal: "1000000", settleTx: `0x${"ee".repeat(32)}`, ...settlement },
  };
}

const render = (c: { text: string; keyboard?: { inline_keyboard: unknown } }) => ({ text: c.text, buttons: c.keyboard?.inline_keyboard });

describe("cards", () => {
  it("draft", () => {
    const card = draftCard(LINKS, 12, "Alpha <Calls>", {
      market: "BTC/USD",
      side: "LONG",
      entry: "81350",
      takeProfit: "84000",
      stopLoss: "80200",
      validHours: 24,
      notes: ["entry range 81200–81500 → midpoint 81350", "2 targets: the first (84000) is the take profit"],
    }, "rules");
    expect(render(card)).toMatchSnapshot();
  });

  it("locked (paid and free)", () => {
    expect(render(lockedCard(LINKS, base, NOW))).toMatchSnapshot();
    expect(lockedCard(LINKS, { ...base, priceUsd: "0" }, NOW).text).toMatch(/· free$/);
  });

  it("results", () => {
    expect(render(resultCard(LINKS, settled({ status: "SETTLED", outcome: "WIN", rMultiple: 1.9, decidedAt: "2026-10-26T20:00:00Z" }, { outcome: "WIN", slashTotal: "0" })))).toMatchSnapshot("win");
    expect(render(resultCard(LINKS, settled({ status: "SETTLED", outcome: "LOSS", rMultiple: -1, decidedAt: "2026-10-26T18:00:00Z" })))).toMatchSnapshot("loss");
    expect(render(resultCard(LINKS, settled({ status: "SETTLED", outcome: "LOSS", rMultiple: -0.4, decidedAt: "2026-10-27T14:02:00Z" })))).toMatchSnapshot("expiry loss");
    expect(render(resultCard(LINKS, settled({ status: "UNREVEALED_LOSS", outcome: "LOSS", rMultiple: -1, revealed: false, side: null, tx: { ...base.tx } })))).toMatchSnapshot("unrevealed");
    expect(render(resultCard(LINKS, settled({ status: "SETTLED", outcome: "VOID" }, { outcome: "VOID", slashTotal: "0" })))).toMatchSnapshot("void");
  });

  it("unlocked and buy", () => {
    expect(render(unlockedCard(LINKS, base))).toMatchSnapshot();
    expect(render(buyCard(LINKS, base, NOW))).toMatchSnapshot();
  });
});
