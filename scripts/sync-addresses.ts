/**
 * Copies contracts/deployments/<chainId>.json into packages/shared/src/addresses.json.
 * Usage: pnpm contracts:export
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const depDir = join(root, "contracts", "deployments");
const target = join(root, "packages", "shared", "src", "addresses.json");

const ZERO = "0x0000000000000000000000000000000000000000";
const current = JSON.parse(readFileSync(target, "utf8")) as Record<string, Record<string, unknown>>;

for (const f of readdirSync(depDir).filter((f) => f.endsWith(".json"))) {
  const d = JSON.parse(readFileSync(join(depDir, f), "utf8")) as Record<string, string | number>;
  const chainId = String(d.chainId);
  const entry: Record<string, unknown> = { startBlock: Number(d.startBlock) };
  for (const [k, v] of Object.entries(d)) {
    if (k === "chainId" || k === "startBlock" || k === "USDT" || k === "USDC_E") continue;
    if (typeof v === "string" && v !== ZERO) entry[k] = v;
  }
  entry.tokens = { USDT: d.USDT, USDC_E: d.USDC_E };
  current[chainId] = entry;
  console.log(`synced chain ${chainId} from ${f}`);
}
writeFileSync(target, JSON.stringify(current, null, 2) + "\n");
