/**
 * Backend for the web wallet e2e tests (apps/web/e2e/wallet.spec.ts): a fresh `nundina_e2e`
 * database, anvil on :8545 with the contracts deployed, the API on :8788 in mock-HSP mode with
 * workers, and seed data:
 *   - provider A with a bond and one live BTC signal (to buy)
 *   - anvil account #5 ("X"): registered provider with a pending draft (to confirm), funded with USDT
 * The browser uses wagmi's mock connector for X; anvil signs for its unlocked dev accounts.
 * Writes apps/web/e2e/.stack.json and keeps running until killed.
 *
 *   pnpm --filter @nundina/api e2e:stack
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const PORT = 8788;
const DB = "postgres://nundina:nundina@localhost:5432/nundina_e2e";
const X_KEY = "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba" as const; // anvil #5

Object.assign(process.env, {
  NODE_ENV: "development",
  LOG_LEVEL: process.env.LOG_LEVEL ?? "warn",
  DATABASE_URL: DB,
  TEST_DATABASE_URL: DB,
  KEY_SERVICE_MASTER_KEY: "22".repeat(32),
  INTERNAL_SECRET: "test-internal-secret-0123456789",
  TELEGRAM_BOT_TOKEN: "123456:TEST_TOKEN",
  CHAIN_ID: "31337",
  HSP_MODE: "mock",
  RUN_WORKERS: "true",
  PORT: String(PORT),
  WEB_ORIGIN: "http://localhost:3001",
  ANVIL_PORT: "8545",
});

async function main() {
  const { default: setupDb } = await import("../test/globalSetup.js");
  await setupDb();
  const { startChain, keys } = await import("../test/chain.js");
  const chain = await startChain();
  const { serve } = await import("@hono/node-server");
  const { createApp } = await import("../src/app.js");
  const { startWorkers } = await import("../src/jobs/workers.js");
  const { initPaymentRail } = await import("../src/payments/index.js");
  const { makeProvider, INTERNAL, postJson } = await import("../test/helpers.js");
  await initPaymentRail();
  await startWorkers();
  const server = serve({ fetch: createApp().fetch, port: PORT });

  // provider A: bonded, one live signal at $0.50
  const a = privateKeyToAccount(generatePrivateKey());
  await chain.registerProvider(a, { bondUsd: "50" });
  const pa = await makeProvider({ address: a.address, handle: "e2e_alpha" });
  const { signalId } = await chain.commitViaApi(a, pa.userId, 500_000n);

  // X: provider with a draft, plus USDT to buy with
  const x = privateKeyToAccount(X_KEY);
  await chain.registerProvider(x, { bondUsd: "20" });
  await chain.mint(chain.usdt, x, 10_000_000n);
  const px = await makeProvider({ address: x.address, handle: "e2e_x" });
  const draft = await postJson(
    "/drafts",
    {
      providerHandle: px.handle,
      rawText: "BTC LONG 81500\nTP 83000\nSL 80800",
      parsed: { market: "BTC/USD", side: "LONG", entry: "81500", takeProfit: "83000", stopLoss: "80800", validHours: 6, notes: [] },
      parser: "rules",
    },
    INTERNAL,
  );
  if (draft.status !== 201) throw new Error(`draft failed: ${JSON.stringify(draft.body)}`);

  const out = { api: `http://localhost:${PORT}`, rpc: chain.rpc, wallet: x.address, signalId: signalId.toString(), draftId: draft.body.id, relayerSet: Boolean(keys.RELAYER_PRIVATE_KEY) };
  writeFileSync(join(import.meta.dirname, "..", "..", "web", "e2e", ".stack.json"), JSON.stringify(out, null, 2));
  console.log(`e2e stack ready ${JSON.stringify(out)}`);

  const stop = () => {
    server.close();
    chain.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
