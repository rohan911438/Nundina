import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProofBox } from "@/components/signal/ProofBox";
import { SignalStatusPill } from "@/components/signal/SignalStatusPill";
import { STATE_LABEL, type SignalState } from "@/lib/signal-state";

afterEach(cleanup);

describe("SignalStatusPill", () => {
  const states = Object.keys(STATE_LABEL) as SignalState[];
  it.each(states)("renders %s with its label and tone", (st) => {
    const { container } = render(<SignalStatusPill state={st} />);
    const pill = container.querySelector(`[data-state="${st}"]`)!;
    expect(pill).toBeTruthy();
    expect(pill.textContent).toBe(STATE_LABEL[st]);
    const tone = { win: "text-win", loss: "text-loss", unrevealed: "text-loss", locked: "text-locked", void: "text-void", refunded: "text-void" }[st as string];
    if (tone) expect(pill.className).toContain(tone);
    expect(pill.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });
});

const H = (c: string) => `0x${c.repeat(64)}`;

describe("ProofBox", () => {
  it("links every on-chain fact to the explorer and lists HSP payment ids", () => {
    render(
      <ProofBox
        chainId={177}
        s={{
          status: "SETTLED",
          commitHash: H("c"),
          committedAt: "2026-10-26T10:00:00Z",
          tx: { commit: H("1"), reveal: H("2"), resolve: H("3") },
          settlement: {
            outcome: "WIN",
            proofTx: H("4"),
            settleTx: H("5"),
            payoutUsd: "1.8",
            refundsUsd: "0",
            slashUsd: "0",
            settledAt: "2026-10-26T12:00:00Z",
          },
          paymentIds: ["pay_abc", "pay_def"],
        }}
      />,
    );
    const box = screen.getByTestId("proof-box");
    const href = (label: string) => within(box).getByRole("link", { name: new RegExp(`${label} on explorer`) }).getAttribute("href");
    expect(href("Commit tx")).toBe(`https://hsk.blockscout.com/tx/${H("1")}`);
    expect(href("Reveal tx")).toBe(`https://hsk.blockscout.com/tx/${H("2")}`);
    expect(href("Oracle proof tx")).toBe(`https://hsk.blockscout.com/tx/${H("4")}`);
    expect(href("Settlement tx")).toBe(`https://hsk.blockscout.com/tx/${H("5")}`);
    expect(within(box).getByText("26 Oct 2026, 10:00 UTC")).toBeTruthy();
    expect(within(box).getByRole("link", { name: /HSP payment pay_abc/ }).getAttribute("href")).toBe("https://hsp.test/payments/pay_abc");
    for (const a of within(box).getAllByRole("link")) expect(a.getAttribute("rel")).toContain("noopener");
  });

  it("shows what's still pending instead of empty links", () => {
    render(
      <ProofBox
        s={{
          status: "UNREVEALED_LOSS",
          commitHash: H("c"),
          committedAt: "2026-10-26T10:00:00Z",
          tx: { commit: H("1"), reveal: null, resolve: null },
          settlement: null,
          paymentIds: [],
        }}
      />,
    );
    expect(screen.getByText("never revealed")).toBeTruthy();
    expect(screen.getByText("after the challenge window")).toBeTruthy();
    expect(screen.getByText("No paid purchases yet")).toBeTruthy();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});
