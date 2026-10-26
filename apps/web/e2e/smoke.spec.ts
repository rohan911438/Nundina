import { expect, test, type APIRequestContext } from "@playwright/test";

const API = process.env.API_URL ?? "http://localhost:8787";

/** Finds a seed signal id for each page state through the API, so the test doesn't hard-code ids. */
async function idsByState(request: APIRequestContext) {
  const list = async (status: string) =>
    ((await (await request.get(`${API}/signals?status=${status}&limit=100`)).json()) as { items: { id: string; outcome: string | null }[] }).items;
  const settled = await list("SETTLED,REFUNDED");
  const pick = (outcome: string) => settled.find((s) => s.outcome === outcome)?.id;
  return {
    locked: (await list("COMMITTED"))[0]?.id,
    win: pick("WIN"),
    loss: pick("LOSS"),
    void: pick("VOID"),
    unrevealed: (await list("UNREVEALED_LOSS"))[0]?.id,
  };
}

test("home loads with live data", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Pay only when the call is");
  await expect(page.getByRole("region", { name: "Recently settled signals" }).getByRole("link").first()).toBeVisible();
  await expect(page.getByText("Signals committed")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Refund if wrong" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

test("leaderboard filters write to the URL", async ({ page }) => {
  await page.goto("/leaderboard");
  await expect(page.getByTestId("leaderboard-row").filter({ visible: true }).first()).toBeVisible();
  await page.getByRole("radio", { name: "All time" }).click();
  await expect(page).toHaveURL(/period=all/);
  await page.getByRole("radio", { name: "Agent" }).click();
  await expect(page).toHaveURL(/type=agent/);
  await page.getByRole("switch", { name: "Verified only" }).click();
  await expect(page).toHaveURL(/verified=1/);
  // every agent here is unverified
  await expect(page.getByText("No providers match these filters")).toBeVisible();
});

test("provider page renders score, curve and history", async ({ page }) => {
  await page.goto("/p/satoshi_signals");
  await expect(page.getByRole("heading", { level: 1, name: "Satoshi Signals" })).toBeVisible();
  await expect(page.getByText("Win rate (lower bound)")).toBeVisible();
  await expect(page.getByTestId("history-row").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy badge" })).toBeVisible();
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/api\/og\/badge\/satoshi_signals/);
});

test("unknown provider shows not found", async ({ page }) => {
  await page.goto("/p/does_not_exist_xyz");
  await expect(page.getByText("Nothing committed here")).toBeVisible();
});

test("signal page renders each state", async ({ page, request }) => {
  test.setTimeout(180_000);
  const ids = await idsByState(request);
  const expectations: [keyof typeof ids, RegExp, boolean][] = [
    ["locked", /Locked until it settles/, true],
    ["win", /Right call/, false],
    ["loss", /Wrong call/, false],
    ["void", /Void/, false],
    ["unrevealed", /Never revealed/, false],
  ];
  for (const [state, banner, buyBox] of expectations) {
    const id = ids[state];
    expect(id, `seed has a ${state} signal`).toBeTruthy();
    await page.goto(`/s/${id}`);
    await expect(page.locator(`[data-state]`).first()).toHaveAttribute("data-state", state);
    await expect(page.getByTestId("state-banner")).toContainText(banner);
    await expect(page.getByTestId("proof-box")).toBeVisible();
    await expect(page.getByTestId("buy-box")).toHaveCount(buyBox ? 1 : 0);
    // levels stay hidden until reveal
    const levels = page.getByTestId("levels");
    if (state === "locked" || state === "unrevealed") await expect(levels).toContainText("locked");
    else await expect(levels).not.toContainText("locked");
  }
});

test("OG images render as PNG", async ({ request }) => {
  for (const path of ["/api/og/badge/satoshi_signals", "/api/og/signal/1000001"]) {
    const res = await request.get(path);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/png");
    expect(res.headers()["cache-control"]).toContain("max-age=600");
  }
});
