import { z } from "zod";

export const PageQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** Opaque cursor: base64url(JSON). */
export function encodeCursor(v: unknown): string {
  return Buffer.from(JSON.stringify(v)).toString("base64url");
}

export function decodeCursor<T>(c: string | undefined): T | undefined {
  if (!c) return undefined;
  try {
    return JSON.parse(Buffer.from(c, "base64url").toString("utf8")) as T;
  } catch {
    return undefined;
  }
}

/** Takes limit+1 rows, returns the page and the next cursor. */
export function page<T>(rows: T[], limit: number, cursorOf: (last: T) => unknown) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last ? encodeCursor(cursorOf(last)) : null };
}
