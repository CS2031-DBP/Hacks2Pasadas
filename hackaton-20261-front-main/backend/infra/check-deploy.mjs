// Exercise deployment ordering without credentials, network, or cloud mutations.
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const dir=await mkdtemp(join(tmpdir(),'tropel-deploy-'));
const shim=`#!${process.execPath}
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const tool=path.basename(process.argv[1]),a=process.argv.slice(2);
fs.appendFileSync(process.env.TRACE,JSON.stringify([tool,...a])+'\\n');
if(tool==='node'){
 if(a[0]==='scripts/smoke.mjs')process.exit(0);
 const r=cp.spawnSync(process.env.REAL_NODE,a,{stdio:'inherit'});process.exit(r.status??1);
}
if(tool==='npm')process.exit(0);
if(tool==='pulumi'){
 if(a[0]==='stack'&&a[1]==='export')console.log(JSON.stringify({deployment:{resources:process.env.EXISTING==='1'?[{type:'gcp:cloudrunv2/job:Job',urn:'urn:job'}]:[]}}));
 else if(a[0]==='stack'&&a[1]==='output')console.log(({repositoryUrl:'region-docker.pkg.dev/project/repo',buildServiceAccount:'projects/project/serviceAccounts/build@example.org',buildSourceBucket:'source',buildLogBucket:'logs',jobName:'setup',apiUrl:'https://api.example.invalid'})[a[2]]||'value');
 else if(a[0]==='stack'&&a.includes('--show-name'))console.log('org/foundation/event');
 process.exit(0);
}
if(tool==='gcloud'){
 if(a[0]==='auth'&&a[1]==='list')console.log('operator@example.org');
 else if(a[0]==='billing')console.log('True');
 else if(a[0]==='artifacts')console.log('sha256:'+'a'.repeat(64));
 else if(a[0]==='secrets')console.log('mock-private-value');
 else if(a[0]==='run'&&process.env.JOB_FAIL==='1')process.exit(17);
 process.exit(0);
}
process.exit(2);
`;
try{
 for(const tool of ['node','npm','pulumi','gcloud'])await writeFile(join(dir,tool),shim,{mode:0o755});
 for(const [name,existing,fail] of [['initial','0','0'],['redeploy','1','0'],['failed-job','1','1']]){
  const trace=join(dir,name+'.jsonl');
  const run=spawnSync('bash',['infra/deploy.sh'],{encoding:'utf8',env:{...process.env,PATH:dir+':'+process.env.PATH,REAL_NODE:process.execPath,TRACE:trace,EXISTING:existing,JOB_FAIL:fail,PROJECT_ID:'test-project',BILLING_ACCOUNT:'test-billing',ALERT_EMAIL:'teacher@example.org',CORS_ORIGINS:'http://localhost:5173'}});
  assert.equal(run.status,fail==='1'?17:0,run.stderr);
  const events=(await readFile(trace,'utf8')).trim().split('\n').map(JSON.parse);
  const job=events.findIndex(x=>x[0]==='gcloud'&&x[1]==='run'&&x[2]==='jobs');
  const publish=events.findIndex(x=>x[0]==='pulumi'&&x[1]==='config'&&x[3]==='publish');
  const smoke=events.findIndex(x=>x[0]==='node'&&x[1]==='scripts/smoke.mjs');
  assert.ok(job>=0);
  if(fail==='1'){assert.equal(publish,-1);assert.equal(smoke,-1);}
  else{assert.ok(publish>job);assert.ok(smoke>publish);}
  const targeted=events.findIndex(x=>x[0]==='pulumi'&&x[1]==='up'&&x.includes('--target'));
  assert.equal(targeted>=0,existing==='1');
  if(targeted>=0)assert.ok(targeted<job);
  console.log('Offline deployment ordering passed: '+name);
 }
}finally{await rm(dir,{recursive:true,force:true});}
