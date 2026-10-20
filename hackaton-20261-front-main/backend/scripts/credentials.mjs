// Private export: fails instead of overwriting or exporting credentials that do not match DB.
import {credentialsForTeam} from '../dist/db/seed.js';
import {config} from '../dist/config.js';
import {createPool} from '../dist/db/pool.js';
import bcrypt from 'bcrypt';
import {writeFile} from 'node:fs/promises';
const destination=process.argv[2];if(!destination)throw Error('Provide private output path outside the repository');
const pool=createPool(),rows=[];
try{for(let i=1;i<=config.seedWorkspaceCount;i++){
 const credential=credentialsForTeam(i);
 const result=await pool.query('SELECT password_hash FROM users WHERE workspace_id=$1',[`ws_${String(i).padStart(3,'0')}`]);
 if(result.rowCount!==3||!(await Promise.all(result.rows.map(x=>bcrypt.compare(credential.password,x.password_hash)))).every(Boolean))throw Error(`Credentials do not match ${credential.teamCode}; check CREDENTIALS_SECRET`);
 rows.push(credential);
}await writeFile(destination,JSON.stringify(rows,null,2)+'\n',{mode:0o600,flag:'wx'});console.log('Private export completed; distribute each team separately.');}finally{await pool.end();}
