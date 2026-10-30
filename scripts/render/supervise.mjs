#!/usr/bin/env node
/**
 * Process supervisor for Render free web services (one instance, 512 MB, sleeps after 15 min
 * without inbound traffic). Runs several apps in one container:
 *
 *   node scripts/render/supervise.mjs backend   API (public $PORT) + bot (polling) + keeper
 *   node scripts/render/supervise.mjs indexer   Ponder + projector, health on $PORT
 *
 * - Each app runs as one `node --import tsx` process (no tsx/pnpm wrappers: ~60 MB saved each).
 * - A crashed app restarts on its own with backoff; the others keep running.
 * - Pings its own public URL every 10 minutes so Render doesn't put it to sleep.
 * - SIGTERM (deploys) is forwarded so each app shuts down cleanly.
 */
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const role = process.argv[2];
const node = process.execPath;
// heap caps keep three apps inside the instance's 512 MB
const tsx = (heapMb, ...entry) => [`--max-old-space-size=${heapMb}`, "--import", "tsx", ...entry];

const ROLES = {
  backend: {
    before: [{ name: "migrate", cwd: "apps/api", args: tsx(160, "src/db/migrate.ts") }],
    apps: [
      { name: "api", cwd: "apps/api", args: tsx(160, "src/index.ts") },
      // polling: no inbound port needed; one instance, so no getUpdates conflict
      { name: "bot", cwd: "apps/bot", args: tsx(96, "src/index.ts"), env: { BOT_WEBHOOK_URL: "" } },
      { name: "keeper", cwd: "apps/keeper", args: tsx(96, "src/index.ts") },
    ],
    pingPath: "/health",
  },
  indexer: {
    before: [],
    apps: [
      {
        name: "ponder",
        cwd: "apps/indexer",
        args: [
          "--max-old-space-size=256",
          "node_modules/ponder/dist/esm/bin/ponder.js",
          "start",
          "--schema",
          process.env.INDEXER_DB_SCHEMA ?? "ponder",
          "--port",
          process.env.INDEXER_PORT ?? "42069",
          "--hostname",
          "127.0.0.1",
        ],
      },
      { name: "projector", cwd: "apps/indexer", args: tsx(96, "projector/sync.ts") },
    ],
    // Ponder stays internal; Render health-checks this supervisor instead
    healthServer: true,
    pingPath: "/health",
  },
};

const cfg = ROLES[role];
if (!cfg) {
  console.error(`usage: supervise.mjs ${Object.keys(ROLES).join("|")}`);
  process.exit(2);
}

const log = (msg, extra = {}) => console.log(JSON.stringify({ level: "info", svc: "supervisor", role, msg, ...extra, time: new Date().toISOString() }));

for (const step of cfg.before) {
  log(`running ${step.name}`);
  const r = spawnSync(node, step.args, { cwd: join(root, step.cwd), stdio: "inherit", env: process.env });
  if (r.status !== 0) {
    log(`${step.name} failed`, { code: r.status });
    process.exit(1);
  }
}

let stopping = false;
const running = new Map();
const started = {};

function start(app, attempt = 0) {
  if (stopping) return;
  const child = spawn(node, app.args, { cwd: join(root, app.cwd), stdio: "inherit", env: { ...process.env, ...app.env } });
  running.set(app.name, child);
  started[app.name] = Date.now();
  log(`started ${app.name}`, { pid: child.pid, attempt });
  child.on("exit", (code, signal) => {
    running.delete(app.name);
    if (stopping) return;
    // a run that lasted a minute counts as healthy: reset the backoff
    const next = Date.now() - started[app.name] > 60_000 ? 0 : attempt + 1;
    const wait = Math.min(60_000, 1000 * 2 ** next);
    log(`${app.name} exited, restarting`, { code, signal, inMs: wait });
    setTimeout(() => start(app, next), wait);
  });
}
for (const app of cfg.apps) start(app);

if (cfg.healthServer) {
  const port = Number(process.env.PORT ?? 10000);
  createServer((req, res) => {
    const up = cfg.apps.map((a) => ({ name: a.name, up: running.has(a.name), since: started[a.name] ? new Date(started[a.name]).toISOString() : null }));
    const ok = up.every((a) => a.up);
    res.writeHead(req.url === "/health" ? (ok ? 200 : 503) : 404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok, role, apps: up }));
  }).listen(port, "0.0.0.0", () => log("health on /health", { port }));
}

// Render sets RENDER_EXTERNAL_URL; a request through its proxy counts as traffic
const self = process.env.RENDER_EXTERNAL_URL;
if (self && process.env.KEEP_AWAKE !== "0") {
  setInterval(() => {
    fetch(`${self}${cfg.pingPath}`, { signal: AbortSignal.timeout(20_000) }).catch((e) => log("keep-awake ping failed", { error: String(e) }));
  }, 10 * 60_000).unref();
}

function shutdown() {
  if (stopping) return;
  stopping = true;
  log("shutting down");
  for (const c of running.values()) c.kill("SIGTERM");
  setTimeout(() => process.exit(0), 10_000).unref();
  const check = setInterval(() => running.size === 0 && process.exit(0), 200);
  check.unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
