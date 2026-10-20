import type pg from "pg";
import { AppError } from "./errors.js";

export async function applyScenario(
  pool: pg.Pool,
  workspaceId: string,
  kind: "read" | "patch",
): Promise<void> {
  const client = await pool.connect();
  let delayMs = 0;
  let shouldFail = false;
  try {
    await client.query("BEGIN");
    const result = await client.query<{
      delay_ms: number;
      next_read_error: boolean;
      next_patch_error: boolean;
    }>(
      `SELECT delay_ms, next_read_error, next_patch_error
       FROM admin_scenarios WHERE workspace_id = $1 FOR UPDATE`,
      [workspaceId],
    );
    const scenario = result.rows[0];
    if (scenario) {
      delayMs = scenario.delay_ms;
      shouldFail = kind === "read" ? scenario.next_read_error : scenario.next_patch_error;
      await client.query(
        `UPDATE admin_scenarios
         SET delay_ms = 0,
             next_read_error = CASE WHEN $2 = 'read' THEN FALSE ELSE next_read_error END,
             next_patch_error = CASE WHEN $2 = 'patch' THEN FALSE ELSE next_patch_error END,
             updated_at = NOW()
         WHERE workspace_id = $1`,
        [workspaceId, kind],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  if (shouldFail) {
    throw new AppError(500, "INTERNAL_ERROR", "Ocurrio un error interno", {}, {}, true);
  }
}
