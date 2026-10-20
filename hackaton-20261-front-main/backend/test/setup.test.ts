import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import pg from 'pg';
import {randomBytes} from 'node:crypto';
import {config} from '../src/config.js';
import {migrate} from '../src/db/migrate.js';
import {seedAll} from '../src/db/seed.js';
const schema=`setup_test_${randomBytes(6).toString('hex')}`;
const connection=config.databaseUrl?{connectionString:config.databaseUrl}:{host:config.dbHost,port:config.dbPort,database:config.dbName,user:config.dbUser,password:config.dbPassword};
const admin=new pg.Pool(connection);
const pool=new pg.Pool({...connection,options:`-c search_path=${schema}`,max:3});
beforeAll(async()=>{await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);});
afterAll(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
describe('setup and migration recovery',()=>{
 it('repairs partial setup and preserves completed teams and account hashes',async()=>{
  await seedAll(pool);
  const users=(await pool.query('SELECT id,password_hash,created_at FROM users ORDER BY id')).rows;
  await pool.query("UPDATE signals SET status='ATENDIDA' WHERE id='sig_001_0001'");
  await pool.query("DELETE FROM signals WHERE id='sig_002_0001'");
  await pool.query('UPDATE setup_state SET complete=FALSE');
  await seedAll(pool);
  expect((await pool.query('SELECT complete FROM setup_state')).rows[0].complete).toBe(true);
  expect((await pool.query("SELECT status FROM signals WHERE id='sig_001_0001'")).rows[0].status).toBe('ATENDIDA');
  expect((await pool.query("SELECT count(*)::int n FROM signals WHERE workspace_id='ws_002'")).rows[0].n).toBe(config.seedSignalsPerWorkspace);
  expect((await pool.query('SELECT id,password_hash,created_at FROM users ORDER BY id')).rows).toEqual(users);
  await pool.query("UPDATE sectors SET current_load=999 WHERE id='sec_001_01'");
  await seedAll(pool);
  expect((await pool.query('SELECT count(*)::int n FROM sectors s WHERE current_load != (SELECT count(*) FROM tropels t WHERE t.sector_id=s.id AND t.workspace_id=s.workspace_id)')).rows[0].n).toBe(0);
 },120000);
 it('backfills incorrect existing sector loads when applying migration 2',async()=>{
  await pool.query('DELETE FROM schema_migrations WHERE version=2');
  await pool.query('DROP TABLE rate_limits, setup_state');
  await pool.query('ALTER TABLE workspaces DROP COLUMN credentials_version');
  await pool.query('UPDATE sectors SET current_load=999');
  await migrate(pool);
  expect((await pool.query('SELECT count(*)::int n FROM sectors s WHERE current_load != (SELECT count(*) FROM tropels t WHERE t.sector_id=s.id AND t.workspace_id=s.workspace_id)')).rows[0].n).toBe(0);
  expect((await pool.query('SELECT complete FROM setup_state')).rows[0].complete).toBe(false);
 });
});
