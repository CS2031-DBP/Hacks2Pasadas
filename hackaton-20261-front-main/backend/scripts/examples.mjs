import {buildApp} from '../dist/app.js';
import {createPool} from '../dist/db/pool.js';
import {writeFile} from 'node:fs/promises';
const pool=createPool(),app=await buildApp({pool,logger:false});
await app.ready();
const token=app.jwt.sign({sub:'usr_001_1',workspaceId:'ws_001',teamCode:'TEAM-001',role:'OPERATOR',email:'operator@tuckersoft.com',displayName:'Operator 1'});
const samples={};
try{for(const path of ['/dashboard/summary','/tropels?size=10&species=','/signals/feed?limit=15&status=','/sectors','/sectors/sec_001_01/story']){
 const response=await app.inject({url:'/api/v1'+path,headers:{authorization:`Bearer ${token}`}});
 if(response.statusCode!==200)throw Error(`Cannot capture ${path}: ${response.statusCode}`);
 samples[path]=response.json();
}await writeFile('contract/examples.json',JSON.stringify(samples,null,2)+'\n');}finally{await app.close();await pool.end();}
