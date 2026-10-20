import bcrypt from "bcrypt";
import { createHmac } from "node:crypto";
import type pg from "pg";
import { pathToFileURL } from "node:url";
import { config } from "../config.js";
import { createPool } from "./pool.js";

type SqlValue = string | number | boolean | Date | null;

const species = ["BLOBITO", "CHISPA", "GRUNON", "DORMILON", "GLITCHY"] as const;
const vitalStates = ["ESTABLE", "HAMBRIENTO", "AGITADO", "MUTANDO", "CRITICO"] as const;
const signalTypes = [
  "HAMBRE",
  "ABANDONO",
  "MUTACION",
  "FUGA",
  "CONFLICTO",
  "REPRODUCCION_MASIVA",
  "SENAL_CORRUPTA",
] as const;
const severities = ["LEVE", "MODERADO", "GRAVE", "CRITICO"] as const;
const statuses = ["RECIBIDA", "PROCESANDO", "ATENDIDA"] as const;
const climates = ["PIXEL_FOREST", "NEON_CAVE", "CLOUD_AQUARIUM", "RETRO_ARCADE"] as const;
const guardians = ["Ada", "Linus", "Grace", "Edsger", "Margaret", "Alan", "Barbara", "Ken"] as const;
const colors = ["emerald", "violet", "cyan", "amber", "rose", "indigo", "lime", "sky"] as const;
const storyTitles = [
  "Primer pulso",
  "Ecos del sector",
  "Energia inestable",
  "Rastro de caos",
  "Punto de quiebre",
  "Respuesta del habitat",
  "Equilibrio emergente",
  "Nuevo ciclo",
] as const;

function pad(value: number, size: number): string {
  return value.toString().padStart(size, "0");
}

function hashSeed(input: string): number {
  let hash = 2166136261;
  for (const character of input) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomGenerator(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4_294_967_296;
  };
}

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)] ?? items[0]!;
}

async function insertRows(
  client: pg.PoolClient,
  table: string,
  columns: readonly string[],
  rows: readonly (readonly SqlValue[])[],
): Promise<void> {
  if (rows.length === 0) return;
  const values: SqlValue[] = [];
  const placeholders = rows.map((row) => {
    const rowPlaceholders = row.map((value) => {
      values.push(value);
      return `$${values.length}`;
    });
    return `(${rowPlaceholders.join(", ")})`;
  });
  await client.query(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${placeholders.join(", ")}`,
    values,
  );
}

export function credentialsForTeam(teamNumber: number, credentialsSecret = config.credentialsSecret) {
  const teamCode = `TEAM-${pad(teamNumber, 3)}`;
  return {
    teamCode,
    email: "operator@tuckersoft.com",
    password: createHmac("sha256", credentialsSecret).update(`tropelcare-v1:${teamCode}`).digest("base64url"),
  };
}

export interface SeedOptions {
  tropelsPerWorkspace: number;
  signalsPerWorkspace: number;
  credentialsSecret: string;
}

export async function seedWorkspace(
  client: pg.PoolClient,
  teamNumber: number,
  options: SeedOptions,
): Promise<void> {
  const team = pad(teamNumber, 3);
  const workspaceId = `ws_${team}`;
  const { teamCode, password } = credentialsForTeam(teamNumber, options.credentialsSecret);
  const random = randomGenerator(hashSeed(teamCode));
  const baseTime = Date.UTC(2026, 5, 1, 12, 0, 0);

  await client.query(
    `INSERT INTO workspaces(id, team_code, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET team_code = EXCLUDED.team_code, display_name = EXCLUDED.display_name`,
    [workspaceId, teamCode, `Tuckersoft ${teamCode}`],
  );
  await client.query("DELETE FROM admin_scenarios WHERE workspace_id = $1", [workspaceId]);

  await client.query("DELETE FROM signals WHERE workspace_id = $1", [workspaceId]);
  await client.query("DELETE FROM tropels WHERE workspace_id = $1", [workspaceId]);
  await client.query("DELETE FROM sector_story_stages WHERE workspace_id = $1", [workspaceId]);
  await client.query("DELETE FROM sectors WHERE workspace_id = $1", [workspaceId]);

  const account = await client.query<{ credentials_version: number }>("SELECT credentials_version FROM workspaces WHERE id=$1 FOR UPDATE", [workspaceId]);
  const count = await client.query<{ n: number }>("SELECT count(*)::int n FROM users WHERE workspace_id=$1",[workspaceId]);
  if (account.rows[0]!.credentials_version !== 1 || count.rows[0]!.n !== 3) {
  await client.query("DELETE FROM users WHERE workspace_id=$1", [workspaceId]);
  const passwordHash = await bcrypt.hash(password, 10);
  await insertRows(
    client,
    "users",
    ["id", "workspace_id", "display_name", "email", "password_hash", "role"],
    [
      [`usr_${team}_1`, workspaceId, "Operator 1", "operator@tuckersoft.com", passwordHash, "OPERATOR"],
      [`usr_${team}_2`, workspaceId, "Operator 2", "operator2@tuckersoft.com", passwordHash, "OPERATOR"],
      [`usr_${team}_3`, workspaceId, "Operator 3", "operator3@tuckersoft.com", passwordHash, "OPERATOR"],
    ],
  );

  await client.query("UPDATE workspaces SET credentials_version=1 WHERE id=$1", [workspaceId]);
  }
  const sectorRows: SqlValue[][] = [];
  const storyRows: SqlValue[][] = [];
  for (let sectorNumber = 1; sectorNumber <= 12; sectorNumber += 1) {
    const sector = pad(sectorNumber, 2);
    const sectorId = `sec_${team}_${sector}`;
    const climate = climates[(sectorNumber - 1) % climates.length]!;
    const stability = 35 + Math.floor(random() * 61);
    sectorRows.push([
      sectorId,
      workspaceId,
      `SEC-${sector}`,
      `Sector ${sector}`,
      climate,
      20,
      8 + Math.floor(random() * 12),
      stability,
      new Date(baseTime + sectorNumber * 60_000),
    ]);

    for (let stage = 0; stage < 8; stage += 1) {
      const event = signalTypes[(sectorNumber + stage) % signalTypes.length]!;
      const stageStability = Math.max(10, Math.min(100, stability + stage * 3 - 8));
      storyRows.push([
        `stage_${team}_${sector}_${stage}`,
        workspaceId,
        sectorId,
        stage,
        storyTitles[stage]!,
        `${storyTitles[stage]} en el Sector ${sector}: ${event.toLowerCase()} altera el ritmo de los Tropeles.`,
        event,
        JSON.stringify({
          stability: stageStability,
          energy: 35 + ((sectorNumber * 7 + stage * 9) % 61),
          alerts: (sectorNumber + stage * 2) % 12,
        }),
        `${climate.toLowerCase()}-stage-${stage + 1}`,
        colors[stage]!,
        stage / 7,
      ]);
    }
  }
  await insertRows(
    client,
    "sectors",
    [
      "id",
      "workspace_id",
      "sector_code",
      "name",
      "climate",
      "capacity",
      "current_load",
      "stability_level",
      "updated_at",
    ],
    sectorRows,
  );
  await insertRows(
    client,
    "sector_story_stages",
    [
      "id",
      "workspace_id",
      "sector_id",
      "stage_order",
      "title",
      "narrative",
      "dominant_event",
      "metrics",
      "asset_key",
      "color_token",
      "progress",
    ],
    storyRows,
  );

  const tropelRows: SqlValue[][] = [];
  for (let index = 1; index <= options.tropelsPerWorkspace; index += 1) {
    const tropel = pad(index, 3);
    const sector = pad(((index - 1) % 12) + 1, 2);
    const createdAt = new Date(baseTime + index * 120_000);
    tropelRows.push([
      `trp_${team}_${tropel}`,
      workspaceId,
      `${pick(["Pixel", "Tropi", "Nube", "Chispa", "Glitch"], random)}-${tropel}`,
      pick(species, random),
      pick(vitalStates, random),
      Math.floor(random() * 101),
      Math.floor(random() * 101),
      Math.floor(random() * 6),
      `sec_${team}_${sector}`,
      pick(guardians, random),
      createdAt,
      new Date(createdAt.getTime() + Math.floor(random() * 86_400_000)),
    ]);
  }
  await insertRows(
    client,
    "tropels",
    [
      "id",
      "workspace_id",
      "name",
      "species",
      "vital_state",
      "energy_level",
      "chaos_index",
      "mutation_stage",
      "sector_id",
      "guardian_name",
      "created_at",
      "updated_at",
    ],
    tropelRows,
  );

  await client.query("UPDATE sectors s SET current_load=(SELECT count(*) FROM tropels t WHERE t.workspace_id=s.workspace_id AND t.sector_id=s.id) WHERE s.workspace_id=$1", [workspaceId]);
  const signalRows: SqlValue[][] = [];
  for (let index = 1; index <= options.signalsPerWorkspace; index += 1) {
    const signal = pad(index, 4);
    const tropelNumber = ((index - 1) % options.tropelsPerWorkspace) + 1;
    const type = pick(signalTypes, random);
    const createdAt = new Date(baseTime + index * 180_000);
    signalRows.push([
      `sig_${team}_${signal}`,
      workspaceId,
      `trp_${team}_${pad(tropelNumber, 3)}`,
      type,
      pick(severities, random),
      pick(statuses, random),
      `Patron ${type.toLowerCase()} detectado por el protocolo del Sector ${pad(((tropelNumber - 1) % 12) + 1, 2)}.`,
      createdAt,
      createdAt,
    ]);
  }
  await insertRows(
    client,
    "signals",
    [
      "id",
      "workspace_id",
      "tropel_id",
      "signal_type",
      "severity",
      "status",
      "raw_content",
      "created_at",
      "updated_at",
    ],
    signalRows,
  );
}

export async function seedAll(databasePool: pg.Pool): Promise<void> {
  const client = await databasePool.connect();
  await client.query("SELECT pg_advisory_lock(4815162342)");
  try {
    await client.query("UPDATE setup_state SET complete=FALSE WHERE id=1");
    for (let teamNumber=1; teamNumber<=config.seedWorkspaceCount; teamNumber++) {
      await client.query("BEGIN");
      try {
        const ws = `ws_${pad(teamNumber,3)}`;
        const counts = await client.query<{ users: number; sectors: number; tropels: number; signals: number; stages: number; version: number; invalid: boolean }>(`
          SELECT (SELECT count(*)::int FROM users WHERE workspace_id=$1) users,
          (SELECT count(*)::int FROM sectors WHERE workspace_id=$1) sectors,
          (SELECT count(*)::int FROM tropels WHERE workspace_id=$1) tropels,
          (SELECT count(*)::int FROM signals WHERE workspace_id=$1) signals,
          (SELECT count(*)::int FROM sector_story_stages WHERE workspace_id=$1) stages,
          EXISTS(SELECT 1 FROM sectors s WHERE workspace_id=$1 AND
            (current_load != (SELECT count(*) FROM tropels t WHERE t.workspace_id=s.workspace_id AND t.sector_id=s.id)
            OR 8 != (SELECT count(*) FROM sector_story_stages st WHERE st.workspace_id=s.workspace_id AND st.sector_id=s.id))) invalid,
          COALESCE((SELECT credentials_version FROM workspaces WHERE id=$1),0) version`, [ws]);
        const c=counts.rows[0]!;
        if (c.users!==3 || c.sectors!==12 || c.tropels!==config.seedTropelsPerWorkspace || c.signals!==config.seedSignalsPerWorkspace || c.stages!==96 || c.version!==1 || c.invalid) {
          await seedWorkspace(client,teamNumber,{tropelsPerWorkspace:config.seedTropelsPerWorkspace,signalsPerWorkspace:config.seedSignalsPerWorkspace,credentialsSecret:config.credentialsSecret});
        }
        await client.query("COMMIT");
      } catch(error) { await client.query("ROLLBACK"); throw error; }
    }
    await client.query("UPDATE setup_state SET complete=TRUE WHERE id=1");
  } finally {
    await client.query("SELECT pg_advisory_unlock(4815162342)");
    client.release();
  }
}
async function main(): Promise<void> {
  const databasePool=createPool();
  try { await seedAll(databasePool); console.log(`Verified ${config.seedWorkspaceCount} workspaces`); }
  finally { await databasePool.end(); }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
