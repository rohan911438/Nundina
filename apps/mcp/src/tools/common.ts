import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ApiError, type Nundina } from "../nundina.js";

export const NOT_ADVICE = "Results are track-record data, not investment advice.";

/** Who is calling: the API client (with the caller's key) plus raw headers for x402. */
export interface Ctx {
  api: Nundina;
  /** Public API calls (no key). */
  anon: Nundina;
  header: (name: string) => string | undefined;
}

export function ok(data: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data };
}

export function fail(code: string, message: string, extra: Record<string, unknown> = {}): CallToolResult {
  const data = { error: code, message, ...extra };
  return { isError: true, content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data };
}

/** API errors become tool errors the model can read; anything else is rethrown. */
export async function guarded(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError) return fail(e.code, e.message, { status: e.status });
    throw e;
  }
}
