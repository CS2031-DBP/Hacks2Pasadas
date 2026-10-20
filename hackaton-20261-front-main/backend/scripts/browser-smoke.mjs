import {chromium} from 'playwright';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import {buildApp} from '../dist/app.js';
import {config} from '../dist/config.js';
import {createPool} from '../dist/db/pool.js';
import {credentialsForTeam} from '../dist/db/seed.js';
const origin=createServer((req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><title>CORS smoke test</title>');});
await new Promise(resolve=>origin.listen(0,'127.0.0.1',resolve));
const originUrl=`http://127.0.0.1:${origin.address().port}`;
const pool=createPool();
await pool.query('TRUNCATE rate_limits');
const app=await buildApp({pool,config:{...config,corsOrigins:[originUrl],rateLimitPerWorkspace:2},logger:true});
const api=await app.listen({host:'127.0.0.1',port:0});
let browser;
try{
 browser=await chromium.launch({headless:true});const page=await browser.newPage();await page.goto(originUrl);
 const result=await page.evaluate(async({api,credentials})=>{
  const login=await fetch(api+'/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(credentials)});
  const {token}=await login.json();const headers={authorization:`Bearer ${token}`,'content-type':'application/json'};
  const patch=await fetch(api+'/api/v1/signals/sig_001_0001/status',{method:'PATCH',headers,body:JSON.stringify({status:'ATENDIDA'})});
  const body=await patch.json();
  await fetch(api+'/api/v1/auth/me',{headers});
  const limited=await fetch(api+'/api/v1/auth/me',{headers});
  return {login:login.status,patch:patch.status,status:body.status,limited:limited.status,retryAfter:limited.headers.get('retry-after')};
 },{api,credentials:credentialsForTeam(1)});
 assert.equal(result.login,200);assert.equal(result.patch,200);assert.equal(result.status,'ATENDIDA');assert.equal(result.limited,429);assert.ok(Number(result.retryAfter)>0);
 console.log('Browser cross-origin smoke passed',result);
}finally{await browser?.close();await app.close();await pool.end();await new Promise(resolve=>origin.close(resolve));}
