/**
 * Cross-platform wrapper for Foundry commands (loads .env, finds forge, guards mainnet).
 *   tsx scripts/contracts.ts deploy <local|testnet|mainnet>
 *   tsx scripts/contracts.ts verify <testnet|mainnet>
 *   tsx scripts/contracts.ts smoke  <local|testnet|mainnet>
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const contractsDir = join(root, "contracts");
if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"));

function forgeBin(): string {
  if (process.env.FORGE_BIN) return process.env.FORGE_BIN;
  const local = join(homedir(), ".foundry", "bin", process.platform === "win32" ? "forge.exe" : "forge");
  return existsSync(local) ? local : "forge";
}

const NETWORKS = {
  local: {
    rpc: () => process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545",
    verifier: null as null | (() => string),
  },
  testnet: {
    rpc: () => need("HSK_TESTNET_RPC_URL"),
    // TODO(confirm): testnet Blockscout URL (see NEEDS-FROM-USER.md)
    verifier: () => `${process.env.HSK_TESTNET_EXPLORER_URL ?? "https://testnet-explorer.hsk.xyz"}/api/`,
  },
  mainnet: {
    rpc: () => need("HSK_RPC_URL"),
    verifier: () => "https://hsk.blockscout.com/api/",
  },
} as const;
type Net = keyof typeof NETWORKS;

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (see .env.example)`);
  return v;
}

function forge(args: string[]) {
  console.log(`> forge ${args.join(" ").replace(/0x[0-9a-fA-F]{64}/g, "<key>")}`);
  const r = spawnSync(forgeBin(), args, { cwd: contractsDir, stdio: "inherit", env: process.env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const [cmd, netArg = "testnet"] = process.argv.slice(2);
const net = netArg as Net;
if (!(net in NETWORKS)) throw new Error(`unknown network ${netArg}`);
const cfg = NETWORKS[net];

if (net === "mainnet" && (cmd === "deploy" || cmd === "smoke") && process.env.CONFIRM_MAINNET !== "yes") {
  console.error("Refusing to touch mainnet: set CONFIRM_MAINNET=yes");
  process.exit(1);
}

switch (cmd) {
  case "deploy": {
    const args = ["script", "script/Deploy.s.sol", "--rpc-url", cfg.rpc(), "--broadcast", "--slow"];
    if (cfg.verifier && process.env.SKIP_VERIFY !== "1") {
      args.push("--verify", "--verifier", "blockscout", "--verifier-url", cfg.verifier());
    }
    forge(args);
    break;
  }
  case "dry-run": {
    process.env.DRY_RUN = "true";
    process.env.CONFIRM_MAINNET = "yes";
    forge(["script", "script/Deploy.s.sol", "--fork-url", cfg.rpc()]);
    break;
  }
  case "verify": {
    if (!cfg.verifier) throw new Error("nothing to verify on local");
    forge([
      "script",
      "script/Deploy.s.sol",
      "--rpc-url",
      cfg.rpc(),
      "--resume",
      "--verify",
      "--verifier",
      "blockscout",
      "--verifier-url",
      cfg.verifier(),
    ]);
    break;
  }
  case "smoke": {
    forge(["script", "script/SmokeTest.s.sol", "--rpc-url", cfg.rpc(), "--broadcast", "--slow"]);
    break;
  }
  default:
    console.error("usage: contracts.ts <deploy|dry-run|verify|smoke> <local|testnet|mainnet>");
    process.exit(1);
}
