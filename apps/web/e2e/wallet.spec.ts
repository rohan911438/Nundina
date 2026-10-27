import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * Wallet flows against a real local stack: `pnpm --filter @nundina/api e2e:stack` (anvil :8545,
 * API :8788 in mock-HSP mode) and the web app on :3001 with the wagmi mock connector
 * (`pnpm --filter @nundina/web e2e:wallet` starts it). Skipped when the stack isn't running.
 */
const stackFile = join(import.meta.dirname, ".stack.json");
const stack = existsSync(stackFile)
  ? (JSON.parse(readFileSync(stackFile, "utf8")) as { wallet: string; signalId: string; draftId: number })
  : null;

test.skip(!stack || !process.env.WALLET_E2E, "wallet e2e stack not running");
test.describe.configure({ mode: "serial" });

/** Connect → sign in → (optionally) derive the decryption key, through the WalletGate. */
async function walkGate(page: Page, needKey: boolean) {
  const steps = needKey ? 3 : 2; // the mock connector is already on the right chain
  for (let i = 0; i < steps; i++) {
    const next = page.getByTestId("wallet-next");
    if (!(await next.isVisible().catch(() => false))) break;
    await next.click();
    await expect(next).toBeEnabled({ timeout: 20_000 }).catch(() => undefined);
  }
}

test("ConfirmSignal: provider edits and locks a draft on-chain", async ({ page }) => {
  await page.goto(`/tg/confirm/${stack!.draftId}`);
  await walkGate(page, false);
  const form = page.getByTestId("confirm-form");
  await expect(form).toBeVisible({ timeout: 30_000 });
  await expect(form.getByText("BTC LONG 81500")).toBeVisible();

  // live validation: a take profit below entry is rejected for a LONG
  const tp = form.getByLabel("Take profit");
  await tp.fill("80000");
  await expect(form.getByText(/LONG requires/)).toBeVisible();
  await expect(page.getByTestId("lock-it")).toBeDisabled();
  await tp.fill("83500");
  await expect(page.getByTestId("lock-it")).toBeEnabled();

  await page.getByTestId("lock-it").click();
  await expect(page.getByTestId("committed")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("committed")).toContainText("Locked on-chain");
});

test("BuyFlow: pay via HSP (mock), credited, decrypted on device", async ({ page }) => {
  const t0 = Date.now();
  // ?web=1: stay on the Mini App screen in a normal browser (otherwise it redirects to /s/:id)
  await page.goto(`/tg/buy/${stack!.signalId}?web=1`);
  await walkGate(page, true);
  await expect(page.getByTestId("buy-flow")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("capacity")).not.toHaveText("—", { timeout: 15_000 });
  await page.getByTestId("pay").click();
  await expect(page.getByTestId("buy-progress")).toBeVisible();
  const unlocked = page.getByTestId("unlocked");
  await expect(unlocked).toBeVisible({ timeout: 90_000 });
  await expect(unlocked).toContainText("LONG");
  await expect(unlocked).toContainText("81,500.00");
  await expect(unlocked).toContainText("83,000.00");
  console.log(`buy → unlock took ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  // the subscriber dashboard decrypts the same purchase locally; after a reload the mock connector
  // must reconnect (real wallets reconnect from storage), but session and key survive: no new signatures
  await page.goto("/dashboard");
  await page.getByTestId("wallet-next").click();
  await expect(page.getByTestId("active-purchase").first()).toContainText("81,500.00", { timeout: 30_000 });
});

test("Agents: create, see the one-time key, pause and resume", async ({ page }) => {
  await page.goto("/dashboard/agents");
  await walkGate(page, false);
  await expect(page.getByTestId("policy-submit")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("policy-submit").click();
  await expect(page.getByTestId("api-key")).toContainText("nk_", { timeout: 20_000 });
  await expect(page.getByTestId("agent-status")).toHaveText("Running");
  await page.getByTestId("pause").click();
  await expect(page.getByTestId("agent-status")).toHaveText("Paused");
  await page.getByTestId("pause").click();
  await expect(page.getByTestId("agent-status")).toHaveText("Running");
});
