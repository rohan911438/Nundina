/**
 * Runs Ponder (raw events) and the projector (src/sync.ts) side by side.
 *   tsx src/run.ts dev|start
 * Ponder's GraphQL is bound to 127.0.0.1:INDEXER_PORT (internal only).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2] === "start" ? "start" : "dev";
export const PONDER_SCHEMA = process.env.INDEXER_DB_SCHEMA ?? "ponder";
const port = process.env.INDEXER_PORT ?? "42069";

const children: ChildProcess[] = [];
function run(cmd: string, args: string[]) {
  const c = spawn(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32", env: process.env });
  c.on("exit", (code) => {
    console.error(`${cmd} ${args[0] ?? ""} exited with ${code}`);
    shutdown(code ?? 1);
  });
  children.push(c);
}

let down = false;
function shutdown(code: number) {
  if (down) return;
  down = true;
  for (const c of children) c.kill();
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

run("pnpm", [
  "exec",
  "ponder",
  mode,
  "--schema",
  PONDER_SCHEMA,
  "--port",
  port,
  "--hostname",
  "127.0.0.1",
  ...(mode === "dev" ? ["--disable-ui"] : []),
]);
run("pnpm", ["exec", "tsx", "src/sync.ts"]);
