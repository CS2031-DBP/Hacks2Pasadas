import { timingSafeEqual } from "node:crypto";
import bcrypt from "bcrypt";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { enforceRateLimit } from "./lib/rate-limit.js";
import { EXPECTED_MIGRATION } from "./db/migrate.js";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import {
  TypeBoxTypeProvider,
} from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import type pg from "pg";
import { config as defaultConfig, type AppConfig } from "./config.js";
import { encodeCursor, decodeCursor, filtersHash } from "./lib/cursor.js";
import { AppError } from "./lib/errors.js";
import { applyScenario } from "./lib/scenario.js";
import {
  Climate,
  ErrorResponse,
  MutableSignalStatus,
  SectorSummary,
  Severity,
  Signal,
  SignalStatus,
  SignalType,
  Species,
  Tropel,
  User,
  VitalState,
  type SignalDto,
  type TropelDto,
} from "./schemas.js";
import { seedWorkspace } from "./db/seed.js";

interface BuildAppOptions {
  pool: pg.Pool;
  config?: AppConfig;
  logger?: boolean;
}

interface TropelRow {
  id: string;
  name: string;
  species: TropelDto["species"];
  vitalState: TropelDto["vitalState"];
  energyLevel: number;
  chaosIndex: number;
  mutationStage: number;
  guardianName: string;
  sectorId: string;
  sectorName: string;
  sectorCode: string;
  createdAt: Date;
  updatedAt: Date;
}

interface SignalRow {
  id: string;
  signalType: SignalDto["signalType"];
  severity: SignalDto["severity"];
  status: SignalDto["status"];
  rawContent: string;
  tropelId: string;
  tropelName: string;
  tropelSpecies: SignalDto["tropel"]["species"];
  createdAt: Date;
  updatedAt: Date;
}

const errorResponses = {
  400: ErrorResponse,
  401: ErrorResponse,
  404: ErrorResponse,
  413: ErrorResponse,
  429: ErrorResponse,
  500: ErrorResponse,
};

function tropelDto(row: TropelRow): TropelDto {
  return {
    id: row.id,
    name: row.name,
    species: row.species,
    vitalState: row.vitalState,
    energyLevel: row.energyLevel,
    chaosIndex: row.chaosIndex,
    mutationStage: row.mutationStage,
    guardianName: row.guardianName,
    sector: { id: row.sectorId, name: row.sectorName, sectorCode: row.sectorCode },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function signalDto(row: SignalRow): SignalDto {
  return {
    id: row.id,
    signalType: row.signalType,
    severity: row.severity,
    status: row.status,
    rawContent: row.rawContent,
    tropel: { id: row.tropelId, name: row.tropelName, species: row.tropelSpecies },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const tropelSelect = `
  SELECT t.id, t.name, t.species, t.vital_state AS "vitalState",
         t.energy_level AS "energyLevel", t.chaos_index AS "chaosIndex",
         t.mutation_stage AS "mutationStage", t.guardian_name AS "guardianName",
         s.id AS "sectorId", s.name AS "sectorName", s.sector_code AS "sectorCode",
         t.created_at AS "createdAt", t.updated_at AS "updatedAt"
  FROM tropels t
  JOIN sectors s ON s.id = t.sector_id AND s.workspace_id = t.workspace_id`;

const signalSelect = `
  SELECT s.id, s.signal_type AS "signalType", s.severity, s.status,
         s.raw_content AS "rawContent", s.created_at AS "createdAt",
         s.updated_at AS "updatedAt", t.id AS "tropelId", t.name AS "tropelName",
         t.species AS "tropelSpecies"
  FROM signals s
  JOIN tropels t ON t.id = s.tropel_id AND t.workspace_id = s.workspace_id`;

export async function buildApp(options: BuildAppOptions) {
  const appConfig = options.config ?? defaultConfig;
  const app = Fastify({
    logger: options.logger ? { redact: ["req.headers.authorization", 'req.headers["x-admin-token"]' , "req.body.password", "password", "token"] } : false,
    trustProxy: appConfig.trustedProxies.length ? appConfig.trustedProxies : false,
    bodyLimit: 32 * 1024,
    disableRequestLogging: true,
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.addHook("onResponse", async (request, reply) => {
    request.log.info({ requestId: request.id, workspaceId: request.user?.workspaceId, userId: request.user?.sub,
      route: request.routeOptions.url ?? "unmatched", status: reply.statusCode, duration: reply.elapsedTime,
      errorCode: (request as FastifyRequest & { errorCode?: string }).errorCode,
      dbActive: options.pool.totalCount - options.pool.idleCount, dbWaiting: options.pool.waitingCount,
    }, "request completed");
  });
  app.addHook("preValidation", async request => {
    const query = request.query as Record<string, unknown> | undefined;
    if (query && ["/api/v1/tropels", "/api/v1/signals/feed"].includes(request.routeOptions.url ?? "")) {
      for (const key of ["species","vitalState","sectorId","q","signalType","severity","status","cursor"]) {
        if (query[key] === "") delete query[key];
      }
    }
  });
  await app.register(cors, {
    methods: ["GET", "HEAD", "POST", "PATCH", "OPTIONS"],
    exposedHeaders: ["Retry-After"],
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      let parsedOrigin: URL;
      try {
        parsedOrigin = new URL(origin);
      } catch {
        return callback(null, false);
      }
      const exact = appConfig.corsOrigins.includes(origin);
      const matchesPattern = appConfig.corsOriginPatterns.some((pattern) => {
        try {
          const parsedPattern = new URL(pattern.replace("*.", "placeholder."));
          if (!pattern.includes("*.")) return origin === pattern;
          const suffix = parsedPattern.hostname.replace(/^placeholder/, "");
          return parsedOrigin.protocol === parsedPattern.protocol && parsedOrigin.port === parsedPattern.port && parsedOrigin.hostname.endsWith(suffix);
        } catch {
          return false;
        }
      });
      callback(null, exact || matchesPattern);
    },
  });
  await app.register(jwt, { secret: appConfig.jwtSecret });
  await app.register(swagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "TropelCare Control API",
        description:
          "Contrato oficial de la hackathon. Todas las rutas protegidas usan el workspace incluido en el JWT.",
        version: "1.0.0",
      },
      servers: [{ url: "/api/v1", description: "API v1" }],
      tags: [
        { name: "Auth", description: "Autenticacion y restauracion de sesion" },
        { name: "Dashboard", description: "Indicadores del workspace" },
        { name: "Tropels", description: "Paginacion, filtros y detalle" },
        { name: "Signals", description: "Feed cursor-based, detalle y cambio de estado" },
        { name: "Sectors", description: "Sectores y etapas de scrollytelling" },
        { name: "System", description: "Salud y contrato" },
      ],
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        },
      },
    },
  });
  await app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: { docExpansion: "list", deepLinking: true },
    staticCSP: true,
  });

  async function authenticate(request: FastifyRequest): Promise<void> {
    try {
      await request.jwtVerify();
    } catch {
      throw new AppError(401, "UNAUTHORIZED", "Token ausente, invalido o expirado");
    }
    await enforceRateLimit(options.pool, "workspace", request.user.workspaceId, appConfig.rateLimitPerWorkspace);
  }

  async function adminAuthenticated(request: FastifyRequest): Promise<void> {
    const token = request.headers["x-admin-token"];
    const provided = typeof token === "string" ? Buffer.from(token) : Buffer.alloc(0);
    const expected = Buffer.from(appConfig.adminToken);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      throw new AppError(401, "UNAUTHORIZED", "Admin token invalido");
    }
  }

  app.setNotFoundHandler((request, reply) => reply.code(404).send({
    error: "NOT_FOUND", message: "Ruta no encontrada", timestamp: new Date().toISOString(), path: request.url.split("?")[0], details: {},
  }));
  app.setErrorHandler((error, request, reply) => {
    const validationIssues =
      typeof error === "object" &&
      error !== null &&
      "validation" in error &&
      Array.isArray(error.validation)
        ? error.validation
        : undefined;
    const appError =
      error instanceof AppError
        ? error
        : validationIssues
          ? new AppError(400, "VALIDATION_ERROR", "La request contiene valores invalidos", {
              issues: validationIssues,
            })
          : (() => {
            const native = error as { statusCode?: number };
            if (native.statusCode === 413) return new AppError(413, "PAYLOAD_TOO_LARGE", "El cuerpo supera 32 KB");
            if (native.statusCode === 429) return new AppError(429, "RATE_LIMITED", "Limite de requests excedido", {}, {"Retry-After": String(reply.getHeader("retry-after") ?? 60)});
            if (native.statusCode && native.statusCode >= 400 && native.statusCode < 500) return new AppError(400, "VALIDATION_ERROR", "La request contiene valores invalidos");
            return new AppError(500, "INTERNAL_ERROR", "Ocurrio un error interno");
          })();
    (request as FastifyRequest & { errorCode?: string }).errorCode = appError.code;
    if (appError.statusCode >= 500) request.log.error({requestId:request.id,errorCode:appError.code,controlledScenario:appError.controlledScenario}, "request failed");
    for (const [name, value] of Object.entries(appError.headers)) reply.header(name, value);
    return reply.status(appError.statusCode).send({
      error: appError.code,
      message: appError.message,
      timestamp: new Date().toISOString(),
      path: request.url.split("?")[0],
      details: appError.details,
    });
  });

  app.get(
    "/api/v1/health",
    {
      schema: {
        tags: ["System"],
        summary: "Liveness del proceso",
        response: { 200: Type.Object({ status: Type.Literal("ok") }) },
      },
    },
    async () => ({ status: "ok" as const }),
  );

  app.get(
    "/api/v1/ready",
    {
      schema: {
        tags: ["System"],
        summary: "Readiness de DB y migraciones",
        response: { 200: Type.Object({ status: Type.Literal("ready"), migrationVersion: Type.Integer() }), 500: ErrorResponse },
      },
    },
    async () => {
      const result = await options.pool.query<{ version: number }>(
        "SELECT MAX(version)::int AS version FROM schema_migrations",
      );
      const version = result.rows[0]?.version;
      if (version !== EXPECTED_MIGRATION) throw new AppError(500, "INTERNAL_ERROR", "Migraciones incompletas");
      const setup = await options.pool.query<{ complete: boolean }>("SELECT complete FROM setup_state WHERE id=1");
      if (!setup.rows[0]?.complete) throw new AppError(500, "INTERNAL_ERROR", "Setup incompleto");
      return { status: "ready" as const, migrationVersion: version };
    },
  );

  app.get(
    "/api/v1/openapi.json",
    { schema: { tags: ["System"], summary: "Contrato OpenAPI oficial" } },
    async (_request, reply) => reply.type("application/json").send(app.swagger()),
  );

  app.post(
    "/api/v1/auth/login",
    {
      onRequest: async request => enforceRateLimit(options.pool, "login", request.ip, 30),
      schema: {
        tags: ["Auth"],
        summary: "Iniciar sesion en un workspace",
        body: Type.Object(
          {
            teamCode: Type.String({ pattern: "^TEAM-[0-9]{3}$", examples: ["TEAM-001"] }),
            email: Type.String({ format: "email", examples: ["operator@tuckersoft.com"] }),
            password: Type.String({ minLength: 1 }),
          },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({
            token: Type.String(),
            expiresAt: Type.String({ format: "date-time" }),
            user: User,
          }),
          ...errorResponses,
        },
      },
    },
    async (request) => {
      const result = await options.pool.query<{
        id: string;
        workspace_id: string;
        display_name: string;
        email: string;
        password_hash: string;
        role: "OPERATOR";
        team_code: string;
      }>(
        `SELECT u.id, u.workspace_id, u.display_name, u.email, u.password_hash, u.role, w.team_code
         FROM users u JOIN workspaces w ON w.id = u.workspace_id
         WHERE w.team_code = $1 AND LOWER(u.email) = LOWER($2)`,
        [request.body.teamCode, request.body.email],
      );
      const row = result.rows[0];
      if (!row || !(await bcrypt.compare(request.body.password, row.password_hash))) {
        throw new AppError(401, "UNAUTHORIZED", "Credenciales invalidas");
      }
      const payload = {
        sub: row.id,
        workspaceId: row.workspace_id,
        teamCode: row.team_code,
        role: row.role,
        email: row.email,
        displayName: row.display_name,
      };
      const token = app.jwt.sign(payload, { expiresIn: "4h" });
      return {
        token,
        expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
        user: {
          id: row.id,
          displayName: row.display_name,
          email: row.email,
          teamCode: row.team_code,
          role: row.role,
        },
      };
    },
  );

  app.get(
    "/api/v1/auth/me",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Auth"],
        summary: "Restaurar la sesion actual",
        security: [{ bearerAuth: [] }],
        response: { 200: User, ...errorResponses },
      },
    },
    async (request) => ({
      id: request.user.sub,
      displayName: request.user.displayName,
      email: request.user.email,
      teamCode: request.user.teamCode,
      role: request.user.role,
    }),
  );

  app.get(
    "/api/v1/dashboard/summary",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Dashboard"],
        summary: "Indicadores del workspace autenticado",
        description: "openSignals y signalsBySeverity cuentan solo RECIBIDA y PROCESANDO; la suma de severidades equivale a openSignals.",
        security: [{ bearerAuth: [] }],
        response: {
          200: Type.Object({
            totalTropels: Type.Integer(),
            criticalTropels: Type.Integer(),
            openSignals: Type.Integer(),
            sectorStabilityAvg: Type.Number(),
            signalsBySeverity: Type.Object({
              LEVE: Type.Integer(),
              MODERADO: Type.Integer(),
              GRAVE: Type.Integer(),
              CRITICO: Type.Integer(),
            }),
            generatedAt: Type.String({ format: "date-time" }),
          }),
          ...errorResponses,
        },
      },
    },
    async (request) => {
      await applyScenario(options.pool, request.user.workspaceId, "read");
      const [tropels, signals, sectors] = await Promise.all([
        options.pool.query<{ total: number; critical: number }>(
          `SELECT COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE vital_state = 'CRITICO')::int AS critical
           FROM tropels WHERE workspace_id = $1`,
          [request.user.workspaceId],
        ),
        options.pool.query<{ severity: "LEVE" | "MODERADO" | "GRAVE" | "CRITICO"; count: number }>(
          `SELECT severity, COUNT(*)::int AS count FROM signals
           WHERE workspace_id = $1 AND status <> 'ATENDIDA' GROUP BY severity`,
          [request.user.workspaceId],
        ),
        options.pool.query<{ average: number }>(
          "SELECT ROUND(AVG(stability_level), 1)::float AS average FROM sectors WHERE workspace_id = $1",
          [request.user.workspaceId],
        ),
      ]);
      const counts = { LEVE: 0, MODERADO: 0, GRAVE: 0, CRITICO: 0 };
      let openSignals = 0;
      for (const row of signals.rows) {
        counts[row.severity] = row.count;
        openSignals += row.count;
      }
      return {
        totalTropels: tropels.rows[0]?.total ?? 0,
        criticalTropels: tropels.rows[0]?.critical ?? 0,
        openSignals,
        sectorStabilityAvg: sectors.rows[0]?.average ?? 0,
        signalsBySeverity: counts,
        generatedAt: new Date().toISOString(),
      };
    },
  );

  app.get(
    "/api/v1/tropels",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Tropels"],
        summary: "Listar Tropeles con paginacion real",
        description: "Filtros combinables; vacio equivale a omitido. page inicia en 0. q busca el nombre sin distinguir mayusculas (maximo 80 caracteres).",
        security: [{ bearerAuth: [] }],
        querystring: Type.Object({
          page: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
          size: Type.Optional(Type.Union([Type.Literal(10), Type.Literal(20), Type.Literal(50)], { default: 20 })),
          species: Type.Optional(Type.Union([Species, Type.Literal("")], { description: "Vacio u omitido: sin filtro" })),
          vitalState: Type.Optional(Type.Union([VitalState, Type.Literal("")], { description: "Vacio u omitido: sin filtro" })),
          sectorId: Type.Optional(Type.String()),
          q: Type.Optional(Type.String({ maxLength: 80 })),
          sort: Type.Optional(
            Type.Union([Type.Literal("name,asc"), Type.Literal("updatedAt,desc"), Type.Literal("chaosIndex,desc")], {
              default: "updatedAt,desc",
            }),
          ),
        }),
        response: {
          200: Type.Object({
            content: Type.Array(Tropel),
            totalElements: Type.Integer(),
            totalPages: Type.Integer(),
            currentPage: Type.Integer(),
            size: Type.Integer(),
          }),
          ...errorResponses,
        },
      },
    },
    async (request) => {
      await applyScenario(options.pool, request.user.workspaceId, "read");
      const page = request.query.page ?? 0;
      const size = request.query.size ?? 20;
      const values: unknown[] = [request.user.workspaceId];
      const conditions = ["t.workspace_id = $1"];
      const add = (sql: string, value: unknown) => {
        values.push(value);
        conditions.push(sql.replace("?", `$${values.length}`));
      };
      if (request.query.species) add("t.species = ?", request.query.species);
      if (request.query.vitalState) add("t.vital_state = ?", request.query.vitalState);
      if (request.query.sectorId) add("t.sector_id = ?", request.query.sectorId);
      if (request.query.q) add("t.name ILIKE ?", `%${request.query.q}%`);
      const where = conditions.join(" AND ");
      const order = {
        "name,asc": "t.name ASC, t.id ASC",
        "updatedAt,desc": "t.updated_at DESC, t.id DESC",
        "chaosIndex,desc": "t.chaos_index DESC, t.id DESC",
      }[request.query.sort ?? "updatedAt,desc"];
      const countResult = await options.pool.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM tropels t WHERE ${where}`,
        values,
      );
      values.push(size, page * size);
      const rows = await options.pool.query<TropelRow>(
        `${tropelSelect} WHERE ${where} ORDER BY ${order} LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values,
      );
      const totalElements = countResult.rows[0]?.count ?? 0;
      return {
        content: rows.rows.map(tropelDto),
        totalElements,
        totalPages: Math.ceil(totalElements / size),
        currentPage: page,
        size,
      };
    },
  );

  app.get(
    "/api/v1/tropels/:id",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Tropels"],
        summary: "Obtener un Tropel por ID",
        security: [{ bearerAuth: [] }],
        params: Type.Object({ id: Type.String() }),
        response: { 200: Tropel, ...errorResponses },
      },
    },
    async (request) => {
      await applyScenario(options.pool, request.user.workspaceId, "read");
      const result = await options.pool.query<TropelRow>(
        `${tropelSelect} WHERE t.workspace_id = $1 AND t.id = $2`,
        [request.user.workspaceId, request.params.id],
      );
      const row = result.rows[0];
      if (!row) throw new AppError(404, "NOT_FOUND", "Tropel no encontrado");
      return tropelDto(row);
    },
  );

  app.get(
    "/api/v1/signals/feed",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Signals"],
        summary: "Feed cursor-based para infinite scroll",
        description: "Orden createdAt DESC, id DESC. Use nextCursor sin modificar filtros; vacio equivale a omitido. null indica el final. totalEstimate es el total filtrado, no el restante. q busca rawContent o nombre del Tropel sin distinguir mayusculas.",
        security: [{ bearerAuth: [] }],
        querystring: Type.Object({
          cursor: Type.Optional(Type.String()),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 30, default: 15 })),
          signalType: Type.Optional(Type.Union([SignalType, Type.Literal("")], { description: "Vacio u omitido: sin filtro" })),
          severity: Type.Optional(Type.Union([Severity, Type.Literal("")], { description: "Vacio u omitido: sin filtro" })),
          status: Type.Optional(Type.Union([SignalStatus, Type.Literal("")], { description: "Vacio u omitido: sin filtro" })),
          q: Type.Optional(Type.String({ maxLength: 80 })),
        }),
        response: {
          200: Type.Object({
            items: Type.Array(Signal),
            nextCursor: Type.Unsafe<string | null>({ type: "string", nullable: true }),
            hasMore: Type.Boolean(),
            totalEstimate: Type.Integer(),
          }),
          ...errorResponses,
        },
      },
    },
    async (request) => {
      await applyScenario(options.pool, request.user.workspaceId, "read");
      const limit = request.query.limit ?? 15;
      const hash = filtersHash({
        signalType: request.query.signalType,
        severity: request.query.severity,
        status: request.query.status,
        q: request.query.q,
      });
      const values: unknown[] = [request.user.workspaceId];
      const conditions = ["s.workspace_id = $1"];
      const add = (sql: string, value: unknown) => {
        values.push(value);
        conditions.push(sql.replace("?", `$${values.length}`));
      };
      if (request.query.signalType) add("s.signal_type = ?", request.query.signalType);
      if (request.query.severity) add("s.severity = ?", request.query.severity);
      if (request.query.status) add("s.status = ?", request.query.status);
      if (request.query.q) add("(s.raw_content ILIKE ? OR t.name ILIKE ?)", `%${request.query.q}%`);
      if (request.query.q) {
        const last = values.length;
        conditions[conditions.length - 1] = `(s.raw_content ILIKE $${last} OR t.name ILIKE $${last})`;
      }
      if (request.query.cursor) {
        const cursor = decodeCursor(request.query.cursor, hash, appConfig.jwtSecret);
        values.push(cursor.createdAt, cursor.id);
        conditions.push(`(s.created_at, s.id) < ($${values.length - 1}::timestamptz, $${values.length})`);
      }
      const where = conditions.join(" AND ");
      const countResult = await options.pool.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM signals s
         JOIN tropels t ON t.id = s.tropel_id AND t.workspace_id = s.workspace_id WHERE ${where.replace(
           / AND \(s\.created_at, s\.id\).*$/,
           "",
         )}`,
        values.slice(0, request.query.cursor ? -2 : undefined),
      );
      values.push(limit + 1);
      const result = await options.pool.query<SignalRow>(
        `${signalSelect} WHERE ${where} ORDER BY s.created_at DESC, s.id DESC LIMIT $${values.length}`,
        values,
      );
      const hasMore = result.rows.length > limit;
      const pageRows = result.rows.slice(0, limit);
      const last = pageRows.at(-1);
      return {
        items: pageRows.map(signalDto),
        nextCursor:
          hasMore && last
            ? encodeCursor(
                { createdAt: last.createdAt.toISOString(), id: last.id, filtersHash: hash },
                appConfig.jwtSecret,
              )
            : null,
        hasMore,
        totalEstimate: countResult.rows[0]?.count ?? 0,
      };
    },
  );

  app.get(
    "/api/v1/signals/:id",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Signals"],
        summary: "Obtener el detalle de una Senal",
        security: [{ bearerAuth: [] }],
        params: Type.Object({ id: Type.String() }),
        response: { 200: Signal, ...errorResponses },
      },
    },
    async (request) => {
      await applyScenario(options.pool, request.user.workspaceId, "read");
      const result = await options.pool.query<SignalRow>(
        `${signalSelect} WHERE s.workspace_id = $1 AND s.id = $2`,
        [request.user.workspaceId, request.params.id],
      );
      const row = result.rows[0];
      if (!row) throw new AppError(404, "NOT_FOUND", "Senal no encontrada");
      return signalDto(row);
    },
  );

  app.patch(
    "/api/v1/signals/:id/status",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Signals"],
        summary: "Cambiar el estado de una Senal",
        description: "Solo PROCESANDO o ATENDIDA. No requiere ETag ni headers especiales.",
        security: [{ bearerAuth: [] }],
        params: Type.Object({ id: Type.String() }),
        body: Type.Object({ status: MutableSignalStatus }, { additionalProperties: false }),
        response: { 200: Signal, ...errorResponses },
      },
    },
    async (request) => {
      await applyScenario(options.pool, request.user.workspaceId, "patch");
      const updated = await options.pool.query<{ id: string }>(
        `UPDATE signals SET status = $3, updated_at = NOW()
         WHERE workspace_id = $1 AND id = $2 RETURNING id`,
        [request.user.workspaceId, request.params.id, request.body.status],
      );
      if (!updated.rows[0]) throw new AppError(404, "NOT_FOUND", "Senal no encontrada");
      const result = await options.pool.query<SignalRow>(
        `${signalSelect} WHERE s.workspace_id = $1 AND s.id = $2`,
        [request.user.workspaceId, request.params.id],
      );
      return signalDto(result.rows[0]!);
    },
  );

  app.get(
    "/api/v1/sectors",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Sectors"],
        summary: "Listar los sectores del workspace",
        security: [{ bearerAuth: [] }],
        response: { 200: Type.Object({ items: Type.Array(SectorSummary) }), ...errorResponses },
      },
    },
    async (request) => {
      await applyScenario(options.pool, request.user.workspaceId, "read");
      const result = await options.pool.query<{
        id: string;
        sectorCode: string;
        name: string;
        climate: "PIXEL_FOREST" | "NEON_CAVE" | "CLOUD_AQUARIUM" | "RETRO_ARCADE";
        capacity: number;
        currentLoad: number;
        stabilityLevel: number;
      }>(
        `SELECT id, sector_code AS "sectorCode", name, climate, capacity,
                current_load AS "currentLoad", stability_level AS "stabilityLevel"
         FROM sectors WHERE workspace_id = $1 ORDER BY sector_code ASC`,
        [request.user.workspaceId],
      );
      return { items: result.rows };
    },
  );

  app.get(
    "/api/v1/sectors/:id/story",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Sectors"],
        summary: "Obtener las 8 etapas de scrollytelling",
        description: "El frontend usa narrative y metrics; assetKey y colorToken controlan el visual CSS local.",
        security: [{ bearerAuth: [] }],
        params: Type.Object({ id: Type.String() }),
        response: {
          200: Type.Object({
            sector: Type.Object({ id: Type.String(), name: Type.String(), climate: Climate }),
            stages: Type.Array(
              Type.Object({
                id: Type.String(),
                order: Type.Integer({ minimum: 0, maximum: 7 }),
                title: Type.String(),
                narrative: Type.String(),
                dominantEvent: SignalType,
                metrics: Type.Object({
                  stability: Type.Integer({minimum:0,maximum:100, description:"Estabilidad simulada de la etapa, porcentaje"}),
                  energy: Type.Integer({minimum:0,maximum:100,description:"Energia simulada de la etapa, porcentaje"}),
                  alerts: Type.Integer({minimum:0,description:"Cantidad simulada de alertas de la etapa"}),
                }),
                assetKey: Type.String({ description: "Identificador para CSS/assets locales, no URL. Ejemplo: pixel_forest-stage-1.", examples: ["pixel_forest-stage-1"] }),
                colorToken: Type.String({ description: "Paleta CSS local: emerald, violet, cyan, amber, rose, indigo, lime, sky.", examples:["emerald"] }),
                progress: Type.Number({ minimum: 0, maximum: 1, description: "Posicion normalizada de la etapa en la historia, no progreso actual del scroll" }),
              }),
              { minItems: 8, maxItems: 8 },
            ),
          }),
          ...errorResponses,
        },
      },
    },
    async (request) => {
      await applyScenario(options.pool, request.user.workspaceId, "read");
      const sector = await options.pool.query<{
        id: string;
        name: string;
        climate: "PIXEL_FOREST" | "NEON_CAVE" | "CLOUD_AQUARIUM" | "RETRO_ARCADE";
      }>("SELECT id, name, climate FROM sectors WHERE workspace_id = $1 AND id = $2", [
        request.user.workspaceId,
        request.params.id,
      ]);
      const sectorRow = sector.rows[0];
      if (!sectorRow) throw new AppError(404, "NOT_FOUND", "Sector no encontrado");
      const stages = await options.pool.query<{
        id: string;
        order: number;
        title: string;
        narrative: string;
        dominantEvent: SignalDto["signalType"];
        metrics: { stability: number; energy: number; alerts: number };
        assetKey: string;
        colorToken: string;
        progress: string;
      }>(
        `SELECT id, stage_order AS "order", title, narrative,
                dominant_event AS "dominantEvent", metrics,
                asset_key AS "assetKey", color_token AS "colorToken", progress
         FROM sector_story_stages
         WHERE workspace_id = $1 AND sector_id = $2 ORDER BY stage_order ASC`,
        [request.user.workspaceId, request.params.id],
      );
      if (stages.rows.length !== 8) {
        throw new AppError(500, "INTERNAL_ERROR", "El sector no tiene exactamente 8 etapas");
      }
      return {
        sector: sectorRow,
        stages: stages.rows.map((stage) => ({ ...stage, progress: Number(stage.progress) })),
      };
    },
  );

  app.post(
    "/api/v1/admin/workspaces/:teamCode/reset",
    {
      preHandler: adminAuthenticated,
      schema: {
        hide: true,
        params: Type.Object({ teamCode: Type.String({ pattern: "^TEAM-[0-9]{3}$" }) }),
        response: { 200: Type.Object({ reset: Type.Boolean(), teamCode: Type.String() }), ...errorResponses },
      },
    },
    async (request) => {
      const teamNumber = Number.parseInt(request.params.teamCode.slice(-3), 10);
      if (teamNumber < 1 || teamNumber > appConfig.seedWorkspaceCount) {
        throw new AppError(404, "NOT_FOUND", "Workspace no encontrado");
      }
      const client = await options.pool.connect();
      try {
        await client.query("BEGIN");
        await seedWorkspace(client, teamNumber, {
          tropelsPerWorkspace: appConfig.seedTropelsPerWorkspace,
          signalsPerWorkspace: appConfig.seedSignalsPerWorkspace,
          credentialsSecret: appConfig.credentialsSecret,
        });
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      return { reset: true, teamCode: request.params.teamCode };
    },
  );

  app.post(
    "/api/v1/admin/workspaces/:teamCode/scenario",
    {
      preHandler: adminAuthenticated,
      schema: {
        hide: true,
        params: Type.Object({ teamCode: Type.String({ pattern: "^TEAM-[0-9]{3}$" }) }),
        body: Type.Object(
          {
            delayMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 3000 })),
            nextReadError: Type.Optional(Type.Boolean()),
            nextPatchError: Type.Optional(Type.Boolean()),
            clear: Type.Optional(Type.Boolean()),
          },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({ configured: Type.Boolean(), teamCode: Type.String() }),
          ...errorResponses,
        },
      },
    },
    async (request) => {
      const workspace = await options.pool.query<{ id: string }>(
        "SELECT id FROM workspaces WHERE team_code = $1",
        [request.params.teamCode],
      );
      const workspaceId = workspace.rows[0]?.id;
      if (!workspaceId) throw new AppError(404, "NOT_FOUND", "Workspace no encontrado");
      const clear = request.body.clear ?? false;
      await options.pool.query(
        `INSERT INTO admin_scenarios(workspace_id, delay_ms, next_read_error, next_patch_error)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (workspace_id) DO UPDATE
         SET delay_ms = EXCLUDED.delay_ms,
             next_read_error = EXCLUDED.next_read_error,
             next_patch_error = EXCLUDED.next_patch_error,
             updated_at = NOW()`,
        [
          workspaceId,
          clear ? 0 : (request.body.delayMs ?? 0),
          clear ? false : (request.body.nextReadError ?? false),
          clear ? false : (request.body.nextPatchError ?? false),
        ],
      );
      return { configured: true, teamCode: request.params.teamCode };
    },
  );


  return app;
}
