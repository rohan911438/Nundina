// Starts the web app on :3001 with the wagmi mock wallet from e2e/.stack.json and runs the wallet
// e2e suite against it. Needs `pnpm --filter @nundina/api e2e:stack` running first.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = import.meta.dirname;
const stackFile = join(dir, ".stack.json");
if (!existsSync(stackFile)) {
  console.error("No e2e/.stack.json: start `pnpm --filter @nundina/api e2e:stack` first");
  process.exit(1);
}
const stack = JSON.parse(readFileSync(stackFile, "utf8"));
const env = {
  ...process.env,
  API_URL: stack.api,
  NEXT_PUBLIC_API_URL: stack.api,
  NEXT_PUBLIC_SITE_URL: "http://localhost:3001",
  NEXT_PUBLIC_CHAIN_ID: "31337",
  NEXT_PUBLIC_E2E_WALLET: stack.wallet,
  WALLET_E2E: "1",
  WEB_URL: "http://localhost:3001",
};
const shell = process.platform === "win32";
// a dev server already on :3001 has no mock wallet, and the tests would fail with "Provider not found."
if (await fetch("http://localhost:3001/legal").then(() => true, () => false)) {
  console.error("Something is already serving :3001. Stop it first: this runner starts its own server with the mock wallet");
  process.exit(1);
}
const web = spawn("npx", ["next", "dev", "--port", "3001"], { cwd: join(dir, ".."), env, stdio: "ignore", shell });

async function up() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch("http://localhost:3001/legal")).ok) return;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  // Next allows one `next dev` per app folder: a dev server on :3000 for apps/web blocks this one
  throw new Error("web did not start on :3001 (is another `next dev` running for apps/web? stop it first)");
}

// one stack = one draft, one signal, one mock wallet: the suite can run once, on one device project
const args = process.argv.slice(2);
if (!args.some((a) => a.startsWith("--project"))) args.push("--project", "desktop");

let code = 1;
try {
  await up();
  // compile the wallet routes once so the first test doesn't race a dev-server reload
  for (const p of [`/tg/confirm/${stack.draftId}`, `/tg/buy/${stack.signalId}?web=1`, "/dashboard", "/dashboard/agents"]) await fetch(`http://localhost:3001${p}`);
  const pw = spawn("npx", ["playwright", "test", "e2e/wallet.spec.ts", ...args], { cwd: join(dir, ".."), env, stdio: "inherit", shell });
  code = await new Promise((r) => pw.on("exit", r));
} finally {
  if (shell) spawnSync("taskkill", ["/F", "/T", "/PID", String(web.pid)]);
  else web.kill();
}
process.exit(code ?? 1);
