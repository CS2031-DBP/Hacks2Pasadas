import { createHash } from "node:crypto";
import { enforceRateLimit } from "../src/lib/rate-limit.js";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import SwaggerParser from "@apidevtools/swagger-parser";
import type { OpenAPI } from "openapi-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { config } from "../src/config.js";
import { migrate } from "../src/db/migrate.js";
import { createPool } from "../src/db/pool.js";
import { seedWorkspace, credentialsForTeam } from "../src/db/seed.js";

const testConfig = {
  ...config,
  seedWorkspaceCount: 2,
  seedTropelsPerWorkspace: 24,
  seedSignalsPerWorkspace: 60,
  credentialsSecret: config.credentialsSecret,
  adminToken: "test-admin-token",
};

let pool: pg.Pool;
let app: FastifyInstance;

async function seedTeams(): Promise<void> {
  const client = await pool.connect();
  try {
    for (const teamNumber of [1, 2]) {
      await client.query("BEGIN");
      await seedWorkspace(client, teamNumber, {
        tropelsPerWorkspace: testConfig.seedTropelsPerWorkspace,
        signalsPerWorkspace: testConfig.seedSignalsPerWorkspace,
        credentialsSecret: testConfig.credentialsSecret,
      });
      await client.query("COMMIT");
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function login(team = 1): Promise<string> {
  const code = team.toString().padStart(3, "0");
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: {
      teamCode: `TEAM-${code}`,
      email: "operator@tuckersoft.com",
      password: credentialsForTeam(team, testConfig.credentialsSecret).password,
    },
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ token: string }>().token;
}

beforeAll(async () => {
  pool = createPool();
  await migrate(pool);
  await pool.query("TRUNCATE rate_limits");
  await seedTeams();
  app = await buildApp({ pool, config: testConfig, logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("public contract", () => {
  it("publishes Swagger with every student endpoint and no admin routes", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/openapi.json" });
    expect(response.statusCode).toBe(200);
    const document = response.json<OpenAPI.Document>();
    await expect(SwaggerParser.validate(document)).resolves.toBeTruthy();
    const paths = Object.keys(document.paths ?? {});
    expect(paths).toEqual(
      expect.arrayContaining([
        "/auth/login",
        "/auth/me",
        "/dashboard/summary",
        "/tropels",
        "/tropels/{id}",
        "/signals/feed",
        "/signals/{id}",
        "/signals/{id}/status",
        "/sectors",
        "/sectors/{id}/story",
      ]),
    );
    expect(paths.some((path) => path.includes("/admin/"))).toBe(false);
  });

  it("authenticates and restores the session", async () => {
    const token = await login();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ teamCode: "TEAM-001", role: "OPERATOR" });
  });

  it("returns actionable validation errors", async () => {
    const token = await login();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/tropels?page=-1&size=11",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "VALIDATION_ERROR", path: "/api/v1/tropels" });
  });
});

describe("workspace isolation and lists", () => {
  it("paginates and combines filters for Tropeles", async () => {
    const token = await login();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/tropels?page=0&size=10&sort=chaosIndex%2Cdesc",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ content: Array<{ chaosIndex: number }>; totalElements: number; size: number }>();
    expect(body.content).toHaveLength(10);
    expect(body.totalElements).toBe(24);
    expect(body.size).toBe(10);
    expect(body.content[0]!.chaosIndex).toBeGreaterThanOrEqual(body.content[1]!.chaosIndex);
  });

  it("uses an opaque cursor without duplicate signal IDs", async () => {
    const token = await login();
    const first = await app.inject({
      method: "GET",
      url: "/api/v1/signals/feed?limit=10",
      headers: { authorization: `Bearer ${token}` },
    });
    const firstBody = first.json<{ items: Array<{ id: string }>; nextCursor: string; hasMore: boolean }>();
    expect(first.statusCode).toBe(200);
    expect(firstBody.hasMore).toBe(true);
    const second = await app.inject({
      method: "GET",
      url: `/api/v1/signals/feed?limit=10&cursor=${encodeURIComponent(firstBody.nextCursor)}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const secondBody = second.json<{ items: Array<{ id: string }> }>();
    expect(second.statusCode).toBe(200);
    const ids = [...firstBody.items, ...secondBody.items].map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);

    const wrongFilters = await app.inject({
      method: "GET",
      url: `/api/v1/signals/feed?limit=10&severity=CRITICO&cursor=${encodeURIComponent(firstBody.nextCursor)}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(wrongFilters.statusCode).toBe(400);
  });

  it("hides resources belonging to another workspace", async () => {
    const token = await login(2);
    const [tropel, signal, story] = await Promise.all([
      app.inject({
        method: "GET",
        url: "/api/v1/tropels/trp_001_001",
        headers: { authorization: `Bearer ${token}` },
      }),
      app.inject({
        method: "GET",
        url: "/api/v1/signals/sig_001_0001",
        headers: { authorization: `Bearer ${token}` },
      }),
      app.inject({
        method: "GET",
        url: "/api/v1/sectors/sec_001_01/story",
        headers: { authorization: `Bearer ${token}` },
      }),
    ]);
    expect([tropel.statusCode, signal.statusCode, story.statusCode]).toEqual([404, 404, 404]);
  });
});

describe("signals, story and TA controls", () => {
  it("updates a signal with a simple PATCH and rejects RECIBIDA", async () => {
    const token = await login();
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/signals/sig_001_0001/status",
      headers: { authorization: `Bearer ${token}` },
      payload: { status: "ATENDIDA" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: "sig_001_0001", status: "ATENDIDA" });

    const invalid = await app.inject({
      method: "PATCH",
      url: "/api/v1/signals/sig_001_0001/status",
      headers: { authorization: `Bearer ${token}` },
      payload: { status: "RECIBIDA" },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it("returns exactly eight ordered story stages", async () => {
    const token = await login();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/sectors/sec_001_01/story",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ stages: Array<{ order: number; progress: number }> }>();
    expect(body.stages).toHaveLength(8);
    expect(body.stages.map((stage) => stage.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(body.stages[0]!.progress).toBe(0);
    expect(body.stages[7]!.progress).toBe(1);
  });

  it("applies a private controlled failure once", async () => {
    const token = await login();
    const configured = await app.inject({
      method: "POST",
      url: "/api/v1/admin/workspaces/TEAM-001/scenario",
      headers: { "x-admin-token": testConfig.adminToken },
      payload: { nextReadError: true },
    });
    expect(configured.statusCode).toBe(200);

    const first = await app.inject({
      method: "GET",
      url: "/api/v1/sectors",
      headers: { authorization: `Bearer ${token}` },
    });
    const second = await app.inject({
      method: "GET",
      url: "/api/v1/sectors",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(first.statusCode).toBe(500);
    expect(first.json()).toMatchObject({ error: "INTERNAL_ERROR" });
    expect(second.statusCode).toBe(200);
  });
});


describe("alignment regression", () => {
  it("treats empty filters like omitted filters, including cursors", async () => {
    const headers = {authorization: `Bearer ${await login()}`};
    for (const [base, empty] of [["/tropels?size=10", "&species=&vitalState=&sectorId=&q="], ["/signals/feed?limit=10", "&signalType=&severity=&status=&q=&cursor="]]) {
      const a = await app.inject({url:`/api/v1${base}`,headers});
      const b = await app.inject({url:`/api/v1${base}${empty}`,headers});
      expect(b.statusCode).toBe(200); expect(b.json()).toEqual(a.json());
      if (a.json().nextCursor) {
        const cursor = encodeURIComponent(a.json().nextCursor);
        const c = await app.inject({url:`/api/v1/signals/feed?limit=10&cursor=${cursor}&severity=&status=`,headers});
        expect(c.statusCode).toBe(200);
      }
    }
    expect((await app.inject({url:"/api/v1/tropels?species=UNKNOWN",headers})).statusCode).toBe(400);
  });
  it("normalizes malformed JSON, large payloads and missing routes", async () => {
    for (const [payload, status, error] of [["{",400,"VALIDATION_ERROR"],[JSON.stringify({text:"x".repeat(33000)}),413,"PAYLOAD_TOO_LARGE"]] as const) {
      const response=await app.inject({method:"POST",url:"/api/v1/auth/login",headers:{"content-type":"application/json"},payload});
      expect(response.statusCode).toBe(status); expect(response.json().error).toBe(error);
    }
    const missing=await app.inject({url:"/api/v1/missing"});
    expect(missing.statusCode).toBe(404); expect(missing.json()).toMatchObject({error:"NOT_FOUND",path:"/api/v1/missing"});
  });
  it("permits browser PATCH and exposes Retry-After only on allowed origins", async () => {
    const response=await app.inject({method:"OPTIONS",url:"/api/v1/signals/sig_001_0001/status",headers:{origin:"http://localhost:5173","access-control-request-method":"PATCH","access-control-request-headers":"authorization,content-type"}});
    expect(response.headers["access-control-allow-methods"]).toContain("PATCH");
    const allowed=await app.inject({url:"/api/v1/health",headers:{origin:"https://test.vercel.app"}});
    expect(allowed.headers["access-control-expose-headers"]).toContain("Retry-After");
    const denied=await app.inject({url:"/api/v1/health",headers:{origin:"https://test.vercel.app.attacker.invalid"}});
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });
  it("counts only open signals and does not mutate a failed PATCH", async () => {
    const headers={authorization:`Bearer ${await login()}`};
    const url="/api/v1/signals/sig_001_0002";
    const before=(await app.inject({url,headers})).json();
    await app.inject({method:"POST",url:"/api/v1/admin/workspaces/TEAM-001/scenario",headers:{"x-admin-token":testConfig.adminToken},payload:{nextPatchError:true}});
    const failed=await app.inject({method:"PATCH",url:`${url}/status`,headers,payload:{status:"ATENDIDA"}});
    expect(failed.statusCode).toBe(500);
    expect((await app.inject({url,headers})).json()).toEqual(before);
    expect((await app.inject({method:"PATCH",url:`${url}/status`,headers,payload:{status:"ATENDIDA"}})).statusCode).toBe(200);
    const dashboard=(await app.inject({url:"/api/v1/dashboard/summary",headers})).json();
    expect(Object.values(dashboard.signalsBySeverity).reduce((a:any,b:any)=>a+b,0)).toBe(dashboard.openSignals);
    const other={authorization:`Bearer ${await login(2)}`};
    expect((await app.inject({method:"PATCH",url:`${url}/status`,headers:other,payload:{status:"ATENDIDA"}})).statusCode).toBe(404);
  });
  it("preserves credentials and other teams on reset, with exact uneven sector loads", async () => {
    const before=await pool.query("SELECT id,password_hash,created_at FROM users ORDER BY id");
    const other=await pool.query("SELECT * FROM signals WHERE workspace_id='ws_002' ORDER BY id");
    const client=await pool.connect();
    try {await client.query("BEGIN");await seedWorkspace(client,1,{tropelsPerWorkspace:121,signalsPerWorkspace:60,credentialsSecret:testConfig.credentialsSecret});await client.query("COMMIT");} finally {client.release();}
    expect((await pool.query("SELECT id,password_hash,created_at FROM users ORDER BY id")).rows).toEqual(before.rows);
    expect((await pool.query("SELECT * FROM signals WHERE workspace_id='ws_002' ORDER BY id")).rows).toEqual(other.rows);
    const mismatches=await pool.query("SELECT s.id FROM sectors s WHERE current_load != (SELECT COUNT(*) FROM tropels t WHERE t.workspace_id=s.workspace_id AND t.sector_id=s.id)");
    expect(mismatches.rowCount).toBe(0);
    await seedTeams();
  });
  it("shares an atomic workspace quota across instances", async () => {
    const token=await login();
    await pool.query("TRUNCATE rate_limits");
    const a=await buildApp({pool,config:{...testConfig,rateLimitPerWorkspace:5},logger:false});
    const b=await buildApp({pool,config:{...testConfig,rateLimitPerWorkspace:5},logger:false});
    try {
      const responses=await Promise.all(Array.from({length:16},(_,i)=>(i%2?a:b).inject({url:"/api/v1/auth/me",headers:{authorization:`Bearer ${token}`}})));
      expect(responses.filter(r=>r.statusCode===200)).toHaveLength(5);
      expect(responses.filter(r=>r.statusCode===429)).toHaveLength(11);
      expect(responses.find(r=>r.statusCode===429)?.headers["retry-after"]).toBeDefined();
    } finally {await a.close();await b.close();await pool.query("TRUNCATE rate_limits");}
  });
  it("returns 429 for excessive login attempts", async () => {
    await pool.query("TRUNCATE rate_limits");
    const results=[];
    for(let i=0;i<31;i++) results.push(await app.inject({method:"POST",url:"/api/v1/auth/login",payload:{}}));
    expect(results[30]!.statusCode).toBe(429);expect(results[30]!.json().error).toBe("RATE_LIMITED");
    await pool.query("TRUNCATE rate_limits");
  });
});

describe("complete checkpoint checks", () => {
  it("rejects missing, invalid and expired sessions", async () => {
    for(const token of [undefined,"invalid",app.jwt.sign({workspaceId:"ws_001",sub:"usr_001_1",teamCode:"TEAM-001",role:"OPERATOR",email:"operator@tuckersoft.com",displayName:"Operator 1"},{expiresIn:-1})]) {
      const response=await app.inject({url:"/api/v1/auth/me",headers:token?{authorization:`Bearer ${token}`}:{}});
      expect(response.statusCode).toBe(401);
    }
    const invalid=await app.inject({method:"POST",url:"/api/v1/auth/login",payload:{teamCode:"TEAM-001",email:"operator@tuckersoft.com",password:"wrong-password"}});
    expect(invalid.statusCode).toBe(401);
  });
  it("walks the complete feed and all twelve stories", async () => {
    const headers={authorization:`Bearer ${await login()}`};
    let cursor:string|null=null;const ids:string[]=[];
    do {
      const response=await app.inject({url:`/api/v1/signals/feed?limit=15${cursor?`&cursor=${encodeURIComponent(cursor)}`:""}`,headers});
      expect(response.statusCode).toBe(200);const body: {items:Array<{id:string}>;nextCursor:string|null;hasMore:boolean;totalEstimate:number}=response.json();
      expect(body.totalEstimate).toBe(60);ids.push(...body.items.map((s:{id:string})=>s.id));
      cursor=body.nextCursor;expect(body.hasMore).toBe(cursor!==null);
    } while(cursor);
    expect(ids).toHaveLength(60);expect(new Set(ids).size).toBe(60);
    const sectors=(await app.inject({url:"/api/v1/sectors",headers})).json().items;
    expect(sectors).toHaveLength(12);
    for(const sector of sectors){
      const story=(await app.inject({url:`/api/v1/sectors/${sector.id}/story`,headers})).json();
      expect(story.stages.map((s:{order:number})=>s.order)).toEqual([0,1,2,3,4,5,6,7]);
      for(const stage of story.stages){expect(stage.progress).toBeCloseTo(stage.order/7,4);expect(stage.metrics.energy).toBeGreaterThanOrEqual(0);expect(stage.metrics.energy).toBeLessThanOrEqual(100);expect(stage.assetKey).toMatch(/-stage-[1-8]$/);}
    }
  });
  it("fails readiness for unfinished setup while liveness stays available", async () => {
    await pool.query("UPDATE setup_state SET complete=FALSE WHERE id=1");
    expect((await app.inject({url:"/api/v1/ready"})).statusCode).toBe(500);
    expect((await app.inject({url:"/api/v1/health"})).statusCode).toBe(200);
    await pool.query("UPDATE setup_state SET complete=TRUE WHERE id=1");
    expect((await app.inject({url:"/api/v1/ready"})).statusCode).toBe(200);
  });
  it("consumes a delayed read once and protects TA controls", async () => {
    const headers={authorization:`Bearer ${await login()}`};
    const url="/api/v1/admin/workspaces/TEAM-001/scenario";
    expect((await app.inject({method:"POST",url,payload:{delayMs:150}})).statusCode).toBe(401);
    await app.inject({method:"POST",url,headers:{"x-admin-token":testConfig.adminToken},payload:{delayMs:150}});
    const start=performance.now();await app.inject({url:"/api/v1/sectors",headers});expect(performance.now()-start).toBeGreaterThanOrEqual(140);
    expect((await pool.query("SELECT delay_ms FROM admin_scenarios WHERE workspace_id='ws_001'")).rows[0].delay_ms).toBe(0);
  });
});


describe("quota window ordering",()=>{
 it("does not reopen a newer window for a delayed request",async()=>{
  const identity="out-of-order-window-test";
  const key=createHash("sha256").update(`workspace:${identity}`).digest("hex");
  await pool.query("INSERT INTO rate_limits(bucket_key,window_start,requests,expires_at) VALUES($1,date_trunc('minute',NOW())+interval '1 minute',3,NOW()+interval '3 minutes')",[key]);
  try{await expect(enforceRateLimit(pool,"workspace",identity,3)).rejects.toMatchObject({statusCode:429});}
  finally{await pool.query("DELETE FROM rate_limits WHERE bucket_key=$1",[key]);}
 });
});
