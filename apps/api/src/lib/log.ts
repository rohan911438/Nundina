import pino from "pino";

const level = process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info");

export const log = pino({
  level,
  redact: {
    paths: ["*.privateKey", "*.aesKey", "*.plaintext", "*.salt", "req.headers.cookie", "req.headers.authorization"],
    censor: "[redacted]",
  },
  ...(process.env.NODE_ENV === "development"
    ? { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } } }
    : {}),
});
