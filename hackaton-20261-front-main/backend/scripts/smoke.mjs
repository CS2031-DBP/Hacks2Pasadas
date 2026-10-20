import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
const url=process.env.API_URL;if(!url)throw Error('API_URL is required');
const team=process.env.SMOKE_TEAM||'TEAM-001';
const password=process.env.SMOKE_PASSWORD||(process.env.CREDENTIALS_SECRET?createHmac('sha256',process.env.CREDENTIALS_SECRET).update(`tropelcare-v1:${team}`).digest('base64url'):undefined);
if(!password)throw Error('SMOKE_PASSWORD or CREDENTIALS_SECRET required');
async function call(path,options={}){const res=await fetch(url+'/api/v1'+path,options);assert.equal(res.status,200,`${path}: HTTP ${res.status}`);return res.json();}
await call('/ready');
const {token}=await call('/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({teamCode:team,email:'operator@tuckersoft.com',password})});
const headers={authorization:`Bearer ${token}`,'content-type':'application/json'};
await call('/auth/me',{headers});
const tropels=await call('/tropels?size=10&species=&vitalState=',{headers});assert.ok(tropels.content.length);
const feed=await call('/signals/feed?limit=10&status=',{headers});assert.ok(feed.items.length);
// Preserve status; select an already mutable status so smoke does not change classification.
const signal=feed.items.find(s=>s.status!=='RECIBIDA')||(await call('/signals/feed?status=ATENDIDA&limit=10',{headers})).items[0];
assert.ok(signal);
const patched=await call(`/signals/${signal.id}/status`,{method:'PATCH',headers,body:JSON.stringify({status:signal.status})});assert.equal(patched.status,signal.status);
const sectors=await call('/sectors',{headers});
const story=await call(`/sectors/${sectors.items[0].id}/story`,{headers});assert.equal(story.stages.length,8);
console.log('Smoke passed: readiness, login, session, tropels, feed, PATCH and story');
