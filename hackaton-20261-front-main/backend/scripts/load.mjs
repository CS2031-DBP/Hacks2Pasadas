// Local isolated benchmark; never resets a database implicitly.
import {buildApp} from '../dist/app.js';
import {config} from '../dist/config.js';
import {createPool} from '../dist/db/pool.js';
import {writeFile} from 'node:fs/promises';
const seconds=Number(process.env.LOAD_SECONDS||600), clients=100;
const pool=createPool(); const app=await buildApp({pool,logger:false});
const address=await app.listen({host:'127.0.0.1',port:0});
const samples={read:[],patch:[]};let failures=0,crossTenant=0,waitingSamples=0,maxWaiting=0,total=0,consecutiveWaiting=0,maxConsecutiveWaiting=0;
const timer=setInterval(()=>{maxWaiting=Math.max(maxWaiting,pool.waitingCount);if(pool.waitingCount){waitingSamples++;consecutiveWaiting++;}else consecutiveWaiting=0;maxConsecutiveWaiting=Math.max(maxConsecutiveWaiting,consecutiveWaiting);},1000);
const start=Date.now();
try {
 await Promise.all(Array.from({length:clients},async(_,i)=>{
  const team=String(i+1).padStart(3,'0');
  const token=app.jwt.sign({workspaceId:`ws_${team}`,teamCode:`TEAM-${team}`,sub:`usr_${team}_1`,email:"operator@tuckersoft.com",displayName:"Operator 1",role:'OPERATOR'});
  let n=i;
  await new Promise(r=>setTimeout(r,i*12.5));
  while(Date.now()-start<seconds*1000){
   const k=n++%10,patch=k===9;
   const route=k<6?'/signals/feed?limit=15':k<8?'/tropels?size=10':k===8?'/dashboard/summary':`/signals/sig_${team}_0001/status`;
   const t=performance.now();
   try {
    const response=await fetch(address+'/api/v1'+route,{method:patch?'PATCH':'GET',headers:{authorization:`Bearer ${token}`,...(patch?{'content-type':'application/json'}:{})},...(patch?{body:JSON.stringify({status:'PROCESANDO'})}:{})});
    const body=await response.json();if(!response.ok)failures++;
    const entities=body.items||body.content||(patch?[body]:[]);
    if(entities.some(x=>x.id&&!x.id.includes(`_${team}_`)))crossTenant++;
   }catch{failures++;}
   samples[patch?'patch':'read'].push(performance.now()-t);total++;
   await new Promise(r=>setTimeout(r,Math.max(0,1250-(performance.now()-t))));
  }
 }));
}finally{clearInterval(timer);await app.close();await pool.end();}
const p95=a=>a.sort((x,y)=>x-y)[Math.ceil(a.length*.95)-1];
const result={seconds,clients,total,failures,errorRate:failures/total,crossTenant,readP95ms:p95(samples.read),patchP95ms:p95(samples.patch),waitingSamples,maxWaiting,maxConsecutiveWaiting,readRequests:samples.read.length,patchRequests:samples.patch.length};
result.pass=result.readP95ms<800&&result.patchP95ms<1000&&result.errorRate<.01&&crossTenant===0&&maxConsecutiveWaiting<3;
await writeFile(process.env.LOAD_REPORT||'load-result.json',JSON.stringify(result,null,2)+'\n');console.log(result);if(!result.pass)process.exitCode=1;
