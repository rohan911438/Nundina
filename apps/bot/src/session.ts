import type { StorageAdapter } from "grammy";
import type { Sql } from "postgres";

/** grammY session storage on the API database's `bot_sessions` table (migration 0003). */
export function pgSessionStorage<T>(sql: Sql): StorageAdapter<T> {
  return {
    async read(key) {
      const [row] = await sql<{ value: T }[]>`select value from bot_sessions where key = ${key}`;
      return row?.value;
    },
    async write(key, value) {
      await sql`insert into bot_sessions (key, value, updated_at) values (${key}, ${sql.json(value as any)}, now())
                on conflict (key) do update set value = excluded.value, updated_at = now()`;
    },
    async delete(key) {
      await sql`delete from bot_sessions where key = ${key}`;
    },
  };
}
