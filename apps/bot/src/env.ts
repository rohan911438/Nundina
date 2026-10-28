import { z } from "zod";

/** Unset or empty (`KEY=` in .env) both fall back to the default. */
const withDefault = (d: string) => z.preprocess((v) => (v === "" ? undefined : v), z.string().default(d));
const optional = z.preprocess((v) => (v === "" ? undefined : v), z.string().optional());

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /** From @BotFather. The bot refuses to start without it; tests use a fake API. */
  TELEGRAM_BOT_TOKEN: optional,
  /** Checked against `X-Telegram-Bot-Api-Secret-Token` on every webhook call. */
  TELEGRAM_WEBHOOK_SECRET: optional,
  /** Public HTTPS URL of this bot's webhook. Unset = long polling (dev). */
  BOT_WEBHOOK_URL: optional,
  BOT_PORT: z.coerce.number().default(8788),
  API_URL: withDefault("http://127.0.0.1:8787"),
  INTERNAL_SECRET: z.string().min(16),
  /** Mini App base (served by apps/web under /tg). */
  MINI_APP_URL: withDefault("http://localhost:3000/tg"),
  WEB_URL: withDefault("http://localhost:3000"),
  DATABASE_URL: z.string().default("postgres://nundina:nundina@localhost:5432/nundina"),
  CHAIN_ID: z.coerce.number().default(31337),
  /** Enables the LLM fallback parser. */
  ANTHROPIC_API_KEY: optional,
});
export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;
export function env(): Env {
  cached ??= EnvSchema.parse(process.env);
  return cached;
}
