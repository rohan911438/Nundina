import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";

/** Creates a fresh test database and runs every migration (needs `pnpm db:up`). */
export default async function setup() {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "postgres://nundina:nundina@localhost:5432/nundina_test");
  const name = url.pathname.slice(1);
  const admin = postgres({ ...parse(url), database: "postgres", onnotice: () => {} });
  await admin.unsafe(`drop database if exists ${name} with (force)`);
  await admin.unsafe(`create database ${name}`);
  await admin.end();

  const sql = postgres(url.toString(), { max: 1, onnotice: () => {} });
  await migrate(drizzle(sql), { migrationsFolder: fileURLToPath(new URL("../src/db/migrations", import.meta.url)) });
  await sql.end();
}

function parse(u: URL) {
  return { host: u.hostname, port: Number(u.port || 5432), username: u.username, password: decodeURIComponent(u.password) };
}
