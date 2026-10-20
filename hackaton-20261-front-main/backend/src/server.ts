import { pathToFileURL } from "node:url";
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db/pool.js";

export async function start(): Promise<void> {
  const app = await buildApp({ pool, config, logger: true });
  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "Shutting down");
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  await app.listen({ port: config.port, host: config.host });


}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await start();
}
