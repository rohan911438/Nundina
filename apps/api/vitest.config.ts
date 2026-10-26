import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/globalSetup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 180_000,
    env: {
      NODE_ENV: "test",
      LOG_LEVEL: "debug",
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://nundina:nundina@localhost:5432/nundina_test",
      KEY_SERVICE_MASTER_KEY: "11".repeat(32),
      INTERNAL_SECRET: "test-internal-secret-0123456789",
      TELEGRAM_BOT_TOKEN: "123456:TEST_TOKEN",
      CHAIN_ID: "31337",
      LOCAL_RPC_URL: "http://127.0.0.1:8546",
      RELAYER_PRIVATE_KEY: "",
    },
  },
});
