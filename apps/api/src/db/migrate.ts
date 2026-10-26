import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { closeDb, db } from "./client.js";
import { log } from "../lib/log.js";

export async function runMigrations() {
  const folder = join(dirname(fileURLToPath(import.meta.url)), "migrations");
  await migrate(db(), { migrationsFolder: folder });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runMigrations()
    .then(() => log.info("migrations applied"))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(closeDb);
}
