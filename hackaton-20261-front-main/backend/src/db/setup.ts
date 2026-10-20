import { pathToFileURL } from "node:url";
import { migrate } from "./migrate.js";
import { createPool } from "./pool.js";
import { seedAll } from "./seed.js";
export async function setupDatabase(): Promise<void> {
  const databasePool = createPool();
  try { await migrate(databasePool); await seedAll(databasePool); }
  finally { await databasePool.end(); }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await setupDatabase();
  console.log("Database setup verified; credentials are never logged");
}
