import pg from "pg";
import { config } from "../config.js";

const { Pool } = pg;

export function createPool(databaseUrl = config.databaseUrl): pg.Pool {
  let connection: pg.PoolConfig;
  if (config.instanceUnixSocket) {
    // Cloud SQL via unix socket (Cloud Run). pg detecta el socket cuando host
    // empieza con "/" y conecta a `${host}/.s.PGSQL.${port}`.
    connection = {
      host: config.instanceUnixSocket,
      port: config.dbPort,
      database: config.dbName,
      user: config.dbUser,
      password: config.dbPassword,
    };
  } else if (databaseUrl) {
    connection = { connectionString: databaseUrl };
  } else {
    connection = {
      host: config.dbHost,
      port: config.dbPort,
      database: config.dbName,
      user: config.dbUser,
      password: config.dbPassword,
    };
  }
  return new Pool({
    ...connection,
    max: config.dbPoolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

export const pool = createPool();
