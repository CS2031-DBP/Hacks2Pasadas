import type pg from "pg";
import { createHash } from "node:crypto";
import { AppError } from "./errors.js";
export async function enforceRateLimit(pool: pg.Pool, scope: string, identity: string, maximum: number): Promise<void> {
  const key = createHash("sha256").update(`${scope}:${identity}`).digest("hex");
  const result = await pool.query<{ requests: number; retry_after: number }>(`
    WITH clock AS (SELECT date_trunc('minute', clock_timestamp()) AS start),
    cleanup AS (DELETE FROM rate_limits WHERE expires_at < clock_timestamp())
    INSERT INTO rate_limits(bucket_key, window_start, requests, expires_at)
    SELECT $1, start, 1, start + interval '2 minutes' FROM clock
    ON CONFLICT (bucket_key) DO UPDATE SET
      requests = CASE WHEN rate_limits.window_start >= EXCLUDED.window_start THEN LEAST(rate_limits.requests + 1, $2 + 1) ELSE 1 END,
      window_start = GREATEST(rate_limits.window_start, EXCLUDED.window_start), expires_at = GREATEST(rate_limits.expires_at, EXCLUDED.expires_at)
    RETURNING requests, GREATEST(1, CEIL(EXTRACT(EPOCH FROM window_start + interval '1 minute' - clock_timestamp())))::int AS retry_after
  `, [key, maximum]);
  const window = result.rows[0]!;
  if (window.requests > maximum) throw new AppError(429, "RATE_LIMITED", "Limite de requests excedido", {}, {"Retry-After": String(window.retry_after)});
}
