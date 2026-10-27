/** Deploys to a throwaway anvil (Deploy.s.sol, dry-run) and runs check-roles against it. */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

process.env.DATABASE_URL ??= "postgres://nundina:nundina@localhost:5432/nundina_test";
process.env.KEY_SERVICE_MASTER_KEY ??= "11".repeat(32);
process.env.INTERNAL_SECRET ??= "test-internal-secret-0123456789";
const { startChain, keys } = await import("../test/chain.js");
const chain = await startChain();
const addr = (k?: string) => (k ? privateKeyToAccount(k as Hex).address : "");
const env = {
  ...process.env,
  CHAIN_ID: "31337",
  LOCAL_RPC_URL: chain.rpc,
  DEPLOYER_ADDRESS: addr(keys.DEPLOYER_PRIVATE_KEY),
  RELAYER_ADDRESS: keys.RELAYER_ADDRESS ?? addr(keys.RELAYER_PRIVATE_KEY),
  CREDIT_SIGNER_ADDRESS: keys.CREDIT_SIGNER_ADDRESS ?? addr(keys.CREDIT_SIGNER_PRIVATE_KEY),
  KEEPER_ADDRESS: keys.KEEPER_ADDRESS ?? addr(keys.KEEPER_PRIVATE_KEY),
  TREASURY_ADDRESS: keys.TREASURY_ADDRESS ?? "",
};
const r = spawnSync("npx", ["tsx", "scripts/check-roles.ts"], { cwd: join(import.meta.dirname, ".."), env, stdio: "inherit", shell: true });
chain.stop();
process.exit(r.status ?? 1);
