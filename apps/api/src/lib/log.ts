import pino from "pino";

const isTest = process.env.NODE_ENV === "test";
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
    ...(process.env.NODE_ENV === "development"
      ? { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } } }
      : {}),
  },
  isTest ? testSink : undefined,
);
