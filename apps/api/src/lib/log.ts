import { createRequire } from "node:module";
import pino from "pino";

const isTest = process.env.NODE_ENV === "test";

/** pino-pretty as an absolute path, or null: other runtimes that import this logger (the Ponder
 *  indexer sets NODE_ENV=development too) can't resolve the bare name and pino would throw. */
function prettyTarget(): string | null {
  try {
    return createRequire(import.meta.url).resolve("pino-pretty");
  } catch {
    return null;
  }
}
const pretty = process.env.NODE_ENV === "development" ? prettyTarget() : null;
const level = process.env.LOG_LEVEL ?? (isTest ? "debug" : "info");

/** Field names that must never reach a log line (any of the first three nesting levels). */
const SECRET_FIELDS = ["privateKey", "aesKey", "aesKeyEnc", "plaintext", "salt", "saltEnc", "wrappedKey", "ciphertext", "mnemonic"];
const redactPaths = SECRET_FIELDS.flatMap((f) => [f, `*.${f}`, `*.*.${f}`]).concat([
  "req.headers.cookie",
  "req.headers.authorization",
  'req.headers["x-internal-secret"]',
]);

/** In tests every line lands here (and nowhere else) so tests can assert on what was logged. */
export const testLogLines: string[] = [];
const testSink = { write: (line: string) => void testLogLines.push(line) };

export const log = pino(
  {
    level,
    redact: { paths: redactPaths, censor: "[redacted]" },
    ...(pretty ? { transport: { target: pretty, options: { colorize: true, translateTime: "HH:MM:ss" } } } : {}),
  },
  isTest ? testSink : undefined,
);
