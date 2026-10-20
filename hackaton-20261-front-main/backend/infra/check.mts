// Offline resource-graph checks. These do not replace a provider preview or deployment.
import assert from 'node:assert/strict';
import * as pulumi from '@pulumi/pulumi';
const mode=process.argv[2]||'job';
process.env.PULUMI_CONFIG=JSON.stringify({
 'test:foundationStack':'organization/foundation/event',
 'test:image':'region-docker.pkg.dev/project/repo/api@sha256:'+'a'.repeat(64),
 'test:corsOrigins':'http://localhost:5173',
 'test:alertEmail':'teacher@example.org',
 'test:publish':mode==='published'?'true':'false',
 'test:billingAccount':'000000-000000-000000',
 'gcp:project':'test-project','gcp:region':'us-central1',
});
const resources:Array<{type:string;inputs:any}>=[];
pulumi.runtime.setMocks({
 newResource(args){
  resources.push({type:args.type,inputs:args.inputs});
  const state={...args.inputs,name:args.inputs.name||args.name,email:`${args.name}@test-project.iam.gserviceaccount.com`,connectionName:'test-project:us-central1:sql',uri:'https://api.example.invalid',result:args.name.padEnd(48,'x')};
  if(args.type==='pulumi:pulumi:StackReference')Object.assign(state,{outputs:{projectId:'test-project',deploymentRegion:'us-central1',connectionName:'test-project:us-central1:sql',databaseName:'tropelcare',databaseUser:'tropelcare_api',runtimeEmail:'runtime@example.org',setupEmail:'setup@example.org',sqlInstanceName:'sql',secretNames:{DB_PASSWORD:'db-password',JWT_SECRET:'jwt-secret',ADMIN_TOKEN:'admin-token',CREDENTIALS_SECRET:'credentials-secret'}}});
  return {id:args.name+'_id',state};
 },
 call(args){return {...args.inputs,number:'123456789'};},
},'test','event',false);
await pulumi.runtime.runInPulumiStack(async()=>{
 if(mode==='foundation')return await import('./foundation/index.js');
 return await import('./application/index.js');
});
if(mode==='foundation'){
 assert.equal(resources.filter(r=>r.type==='gcp:secretmanager/secret:Secret').length,4);
 assert.ok(resources.some(r=>r.type==='gcp:billing/budget:Budget'));
 assert.ok(resources.filter(r=>r.type==='gcp:storage/bucket:Bucket').every(r=>r.inputs.publicAccessPrevention==='enforced'));
}else{
 const job=resources.find(r=>r.type==='gcp:cloudrunv2/job:Job');assert.ok(job);
 assert.deepEqual(job.inputs.template.template.containers[0].args,['dist/db/setup.js']);
 const service=resources.find(r=>r.type==='gcp:cloudrunv2/service:Service');
 assert.equal(Boolean(service),mode==='published','Initial provisioning must not publish before successful setup');
 if(service){
  const container=service.inputs.template.containers[0];
  assert.equal(container.startupProbe.httpGet.path,'/api/v1/ready');
  assert.equal(container.livenessProbe.httpGet.path,'/api/v1/health');
  assert.equal(service.inputs.template.scaling.maxInstanceCount,3);
  for(const name of ['DB_PASSWORD','JWT_SECRET','ADMIN_TOKEN','CREDENTIALS_SECRET']){
   const variable=container.envs.find((v:any)=>v.name===name);assert.ok(variable.valueSource.secretKeyRef);assert.equal(variable.value,undefined);
  }
 }
}
console.log(`Offline infrastructure checks passed: ${mode}`);
