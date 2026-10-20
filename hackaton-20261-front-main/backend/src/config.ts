import "dotenv/config";
function integer(name: string, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0 || value > max) throw new Error(`${name} must be an integer between 1 and ${max}`);
  return value;
}
const production = process.env.NODE_ENV === "production";
function secret(name: string, fallback: string): string {
  const value = process.env[name];
  if (production && (!value || value.length < 32 || value === fallback || value.startsWith("replace-"))) throw new Error(`${name} must be explicitly configured with at least 32 characters in production`);
  return value ?? fallback;
}
export const config = {
  port: integer("PORT", 8080, 65535), host: process.env.HOST ?? "0.0.0.0",
  nodeEnv: process.env.NODE_ENV ?? "development", databaseUrl: process.env.DATABASE_URL,
  instanceUnixSocket: process.env.INSTANCE_UNIX_SOCKET ?? (process.env.INSTANCE_CONNECTION_NAME ? `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}` : undefined),
  dbHost: process.env.DB_HOST ?? "localhost", dbPort: integer("DB_PORT", 5432, 65535),
  dbName: process.env.DB_NAME ?? "tropelcare", dbUser: process.env.DB_USER ?? "tropelcare",
  dbPassword: process.env.DB_PASSWORD ?? "tropelcare", dbPoolMax: integer("DB_POOL_MAX", 10, 10),
  jwtSecret: secret("JWT_SECRET", "development-jwt-secret-change-me"),
  adminToken: secret("ADMIN_TOKEN", "development-admin-secret-change-me"),
  credentialsSecret: secret("CREDENTIALS_SECRET", "development-credentials-secret-local-only"),
  trustedProxies: (process.env.TRUSTED_PROXIES ?? "").split(",").map(x => x.trim()).filter(Boolean),
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:5173").split(",").map(x => x.trim()).filter(Boolean),
  corsOriginPatterns: (process.env.CORS_ORIGIN_PATTERNS ?? "https://*.vercel.app,https://*.netlify.app").split(",").map(x => x.trim()).filter(Boolean),
  rateLimitPerWorkspace: integer("RATE_LIMIT_PER_WORKSPACE", 600),
  seedWorkspaceCount: integer("SEED_WORKSPACE_COUNT", 100, 100),
  seedTropelsPerWorkspace: integer("SEED_TROPELS_PER_WORKSPACE", 120, 1000),
  seedSignalsPerWorkspace: integer("SEED_SIGNALS_PER_WORKSPACE", 600, 3000),
} as const;
if (production && new Set([config.jwtSecret, config.adminToken, config.credentialsSecret]).size !== 3) throw new Error("JWT_SECRET, ADMIN_TOKEN and CREDENTIALS_SECRET must be distinct");
export type AppConfig = typeof config;
