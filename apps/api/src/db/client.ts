import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env.js";
import * as schema from "./schema.js";

export type Db = PostgresJsDatabase<typeof schema>;

let sqlClient: postgres.Sql | undefined;
let dbClient: Db | undefined;

export function sql(): postgres.Sql {
  sqlClient ??= postgres(env().DATABASE_URL, { max: 10, onnotice: () => {} });
  return sqlClient;
}

export function db(): Db {
  dbClient ??= drizzle(sql(), { schema });
  return dbClient;
}

export async function closeDb() {
  await sqlClient?.end({ timeout: 5 });
  sqlClient = undefined;
  dbClient = undefined;
}

export { schema };
