import type pg from "pg";
import { pathToFileURL } from "node:url";
import { createPool } from "./pool.js";

export const EXPECTED_MIGRATION = 2;
const migration = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  team_code TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('OPERATOR')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, email)
);

CREATE TABLE IF NOT EXISTS sectors (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  sector_code TEXT NOT NULL,
  name TEXT NOT NULL,
  climate TEXT NOT NULL CHECK (climate IN ('PIXEL_FOREST', 'NEON_CAVE', 'CLOUD_AQUARIUM', 'RETRO_ARCADE')),
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  current_load INTEGER NOT NULL CHECK (current_load >= 0),
  stability_level INTEGER NOT NULL CHECK (stability_level BETWEEN 0 AND 100),
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (workspace_id, sector_code)
);

CREATE TABLE IF NOT EXISTS tropels (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  species TEXT NOT NULL CHECK (species IN ('BLOBITO', 'CHISPA', 'GRUNON', 'DORMILON', 'GLITCHY')),
  vital_state TEXT NOT NULL CHECK (vital_state IN ('ESTABLE', 'HAMBRIENTO', 'AGITADO', 'MUTANDO', 'CRITICO')),
  energy_level INTEGER NOT NULL CHECK (energy_level BETWEEN 0 AND 100),
  chaos_index INTEGER NOT NULL CHECK (chaos_index BETWEEN 0 AND 100),
  mutation_stage INTEGER NOT NULL CHECK (mutation_stage BETWEEN 0 AND 5),
  sector_id TEXT NOT NULL REFERENCES sectors(id) ON DELETE RESTRICT,
  guardian_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  tropel_id TEXT NOT NULL REFERENCES tropels(id) ON DELETE CASCADE,
  signal_type TEXT NOT NULL CHECK (signal_type IN ('HAMBRE', 'ABANDONO', 'MUTACION', 'FUGA', 'CONFLICTO', 'REPRODUCCION_MASIVA', 'SENAL_CORRUPTA')),
  severity TEXT NOT NULL CHECK (severity IN ('LEVE', 'MODERADO', 'GRAVE', 'CRITICO')),
  status TEXT NOT NULL CHECK (status IN ('RECIBIDA', 'PROCESANDO', 'ATENDIDA')),
  raw_content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS sector_story_stages (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  sector_id TEXT NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
  stage_order INTEGER NOT NULL CHECK (stage_order BETWEEN 0 AND 7),
  title TEXT NOT NULL,
  narrative TEXT NOT NULL,
  dominant_event TEXT NOT NULL,
  metrics JSONB NOT NULL,
  asset_key TEXT NOT NULL,
  color_token TEXT NOT NULL,
  progress NUMERIC(5,4) NOT NULL CHECK (progress BETWEEN 0 AND 1),
  UNIQUE (workspace_id, sector_id, stage_order)
);

CREATE TABLE IF NOT EXISTS admin_scenarios (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  delay_ms INTEGER NOT NULL DEFAULT 0 CHECK (delay_ms BETWEEN 0 AND 3000),
  next_read_error BOOLEAN NOT NULL DEFAULT FALSE,
  next_patch_error BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tropels_workspace_name
  ON tropels(workspace_id, name);
CREATE INDEX IF NOT EXISTS idx_tropels_workspace_filters
  ON tropels(workspace_id, species, vital_state, sector_id);
CREATE INDEX IF NOT EXISTS idx_tropels_workspace_updated
  ON tropels(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_workspace_created
  ON signals(workspace_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_signals_workspace_filters
  ON signals(workspace_id, signal_type, severity, status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_signals_workspace_tropel
  ON signals(workspace_id, tropel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_story_workspace_sector_order
  ON sector_story_stages(workspace_id, sector_id, stage_order);
`;

export async function migrate(databasePool: pg.Pool): Promise<void> {
  const client = await databasePool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(4815162341)");
    await client.query(migration);
    const installed = await client.query("SELECT 1 FROM schema_migrations WHERE version = 2");
    if (!installed.rowCount) {
      await client.query(`
        CREATE TABLE rate_limits (
          bucket_key TEXT PRIMARY KEY, window_start TIMESTAMPTZ NOT NULL,
          requests INTEGER NOT NULL, expires_at TIMESTAMPTZ NOT NULL
        );
        CREATE INDEX idx_rate_limits_expiry ON rate_limits(expires_at);
        CREATE TABLE setup_state (id INTEGER PRIMARY KEY CHECK(id=1), complete BOOLEAN NOT NULL DEFAULT FALSE);
        INSERT INTO setup_state(id, complete) VALUES (1,FALSE);
        ALTER TABLE workspaces ADD COLUMN credentials_version INTEGER NOT NULL DEFAULT 0;
        UPDATE sectors s SET current_load = (SELECT count(*) FROM tropels t WHERE t.workspace_id=s.workspace_id AND t.sector_id=s.id);
        INSERT INTO schema_migrations(version) VALUES (2);
      `);
    }
    await client.query(
      "INSERT INTO schema_migrations(version) VALUES (1) ON CONFLICT (version) DO NOTHING",
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const databasePool = createPool();
  try {
    await migrate(databasePool);
    console.log("Database migration completed");
  } finally {
    await databasePool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
