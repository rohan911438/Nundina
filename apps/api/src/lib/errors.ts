import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { log } from "./log.js";

/** An error that is safe to show to API clients. */
export class ApiError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new ApiError(400, code, message, details);
export const unauthorized = (message = "Sign in required") => new ApiError(401, "unauthorized", message);
export const forbidden = (message = "Not allowed") => new ApiError(403, "forbidden", message);
export const notFound = (what = "Resource") => new ApiError(404, "not_found", `${what} not found`);
export const conflict = (code: string, message: string) => new ApiError(409, code, message);

export function onError(err: Error, c: Context) {
  if (err instanceof ApiError) {
    return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status);
  }
  if (err instanceof HTTPException) {
    return c.json({ error: { code: "http_error", message: err.message } }, err.status);
  }
  log.error({ err, path: c.req.path }, "unhandled error");
  return c.json({ error: { code: "internal", message: "Internal error" } }, 500);
}
