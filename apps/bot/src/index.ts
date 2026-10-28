/**
 * Telegram bot entry point: webhook (secret token checked) when BOT_WEBHOOK_URL is set, long polling
 * otherwise. Also consumes the API's notify.* jobs from pg-boss.
 */
import { createServer } from "node:http";
import { webhookCallback } from "grammy";
import { PgBoss } from "pg-boss";
import postgres from "postgres";
import { Api } from "./api.js";
import { ALLOWED_UPDATES, createBot } from "./bot.js";
import type { Deps, SessionData } from "./context.js";
import { env } from "./env.js";
import { RECHECK_MS, recheckChannels } from "./channels.js";
import { COMMANDS } from "./handlers/commands.js";
import { startNotifyWorkers } from "./notify/index.js";
import { anthropicExtractor } from "./parser/index.js";
import { pgSessionStorage } from "./session.js";

const WEBHOOK_PATH = "/telegram/webhook";

async function main() {
  const e = env();
  if (!e.TELEGRAM_BOT_TOKEN) {
    console.error("TELEGRAM_BOT_TOKEN is not set (see NEEDS-FROM-USER.md). The bot cannot start.");
    process.exit(1);
  }
  if (e.BOT_WEBHOOK_URL && !e.TELEGRAM_WEBHOOK_SECRET) throw new Error("TELEGRAM_WEBHOOK_SECRET is required in webhook mode");

  const sql = postgres(e.DATABASE_URL, { max: 3, onnotice: () => {} });
  const boss = new PgBoss({ connectionString: e.DATABASE_URL, schema: "pgboss" });
  boss.on("error", (err) => console.error("pg-boss error", err));
  await boss.start();

  const log: Deps["log"] = (level, msg, extra) => console[level](JSON.stringify({ level, msg, ...extra, time: new Date().toISOString() }));
  const placeholder = { chainId: e.CHAIN_ID, miniApp: e.MINI_APP_URL, web: e.WEB_URL, botUsername: "" };
  const deps: Deps = {
    api: new Api(e.API_URL, e.INTERNAL_SECRET),
    links: placeholder,
    llm: e.ANTHROPIC_API_KEY ? anthropicExtractor(e.ANTHROPIC_API_KEY) : null,
    schedule: (name, data, startAfter, singletonKey) => boss.send(name, data, { startAfter, singletonKey }),
    log,
  };
  if (!deps.llm) log("warn", "ANTHROPIC_API_KEY not set: LLM fallback parser disabled");

  const bot = createBot(e.TELEGRAM_BOT_TOKEN, deps, { storage: pgSessionStorage<SessionData>(sql) });
  await bot.init();
  placeholder.botUsername = bot.botInfo.username;
  await bot.api.setMyCommands(COMMANDS);
  await startNotifyWorkers(boss, deps, bot.api);

  // channels must stay owned by their provider (and keep the bot as admin) to stay verified
  const recheck = () => recheckChannels(deps, bot.api, bot.botInfo.id).catch((err) => log("warn", "channel recheck failed", { error: String(err) }));
  const firstCheck = setTimeout(recheck, 60_000);
  const recheckTimer = setInterval(recheck, RECHECK_MS);

  let stop: () => Promise<void>;
  if (e.BOT_WEBHOOK_URL) {
    const handle = webhookCallback(bot, "http", { secretToken: e.TELEGRAM_WEBHOOK_SECRET });
    const server = createServer((req, res) => {
      if (req.method === "POST" && req.url === WEBHOOK_PATH) return void handle(req, res);
      res.writeHead(req.url === "/health" ? 200 : 404).end();
    }).listen(e.BOT_PORT);
    await bot.api.setWebhook(`${e.BOT_WEBHOOK_URL.replace(/\/$/, "")}${WEBHOOK_PATH}`, {
      secret_token: e.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: [...ALLOWED_UPDATES],
    });
    log("info", "bot webhook listening", { port: e.BOT_PORT, username: bot.botInfo.username });
    stop = async () => void server.close();
  } else {
    await bot.api.deleteWebhook();
    void bot.start({ allowed_updates: [...ALLOWED_UPDATES], onStart: (me) => log("info", "bot polling", { username: me.username }) });
    stop = () => bot.stop();
  }

  const shutdown = async () => {
    clearTimeout(firstCheck);
    clearInterval(recheckTimer);
    await stop();
    await boss.stop();
    await sql.end();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
