import {buildApp} from '../dist/app.js';
import {createPool} from '../dist/db/pool.js';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const pool=createPool();const app=await buildApp({pool,logger:false});
await app.ready();const text=JSON.stringify(app.swagger(),null,2)+'\n';
try{if(process.argv.includes('--update'))await writeFile('contract/openapi.json',text);else assert.equal(text,await readFile('contract/openapi.json','utf8'),'OpenAPI changed: review and run npm run contract:update');}finally{await app.close();await pool.end();}
