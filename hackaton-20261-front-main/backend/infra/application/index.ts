import * as pulumi from '@pulumi/pulumi';
import * as gcp from '@pulumi/gcp';
const cfg=new pulumi.Config();
const base=new pulumi.StackReference(cfg.require('foundationStack'));
const project=base.requireOutput('projectId') as pulumi.Output<string>;
const region=base.requireOutput('deploymentRegion') as pulumi.Output<string>;
const image=cfg.require('image');
if(!image.includes('@sha256:'))throw new Error('image must be an immutable digest');
const secretNames=base.requireOutput('secretNames') as pulumi.Output<Record<string,string>>;
const envs=[{name:'NODE_ENV',value:'production'},{name:'DB_POOL_MAX',value:'10'},{name:'INSTANCE_CONNECTION_NAME',value:base.requireOutput('connectionName')},{name:'DB_NAME',value:base.requireOutput('databaseName')},{name:'DB_USER',value:base.requireOutput('databaseUser')},{name:'CORS_ORIGINS',value:cfg.require('corsOrigins')},{name:'CORS_ORIGIN_PATTERNS',value:cfg.get('corsOriginPatterns')??'https://*.vercel.app,https://*.netlify.app'},
// Trust only local/link-local managed proxy addresses; validate the deployed ingress path.
{name:'TRUSTED_PROXIES',value:cfg.get('trustedProxies')??'loopback,linklocal'},
...['DB_PASSWORD','JWT_SECRET','ADMIN_TOKEN','CREDENTIALS_SECRET'].map(name=>({name,valueSource:{secretKeyRef:{secret:secretNames.apply(v=>v[name]),version:'latest'}}}))];
const volumes=[{name:'cloudsql',cloudSqlInstance:{instances:[base.requireOutput('connectionName')]}}];
const container={image,envs,volumeMounts:[{name:'cloudsql',mountPath:'/cloudsql'}],resources:{limits:{cpu:'1',memory:'1Gi'}}};
const job=new gcp.cloudrunv2.Job('setup',{project,location:region,name:'tropelcare-setup',deletionProtection:false,template:{taskCount:1,parallelism:1,template:{serviceAccount:base.requireOutput('setupEmail'),maxRetries:1,timeout:'1800s',volumes,containers:[{...container,commands:['node'],args:['dist/db/setup.js']}]}}});
export const jobName=job.name;
let service:gcp.cloudrunv2.Service|undefined;
if(cfg.getBoolean('publish')){
 service=new gcp.cloudrunv2.Service('api',{project,location:region,name:'tropelcare-api',deletionProtection:false,ingress:'INGRESS_TRAFFIC_ALL',template:{serviceAccount:base.requireOutput('runtimeEmail'),maxInstanceRequestConcurrency:80,timeout:'60s',scaling:{minInstanceCount:1,maxInstanceCount:3},volumes,containers:[{...container,ports:{containerPort:8080},startupProbe:{httpGet:{path:'/api/v1/ready',port:8080},periodSeconds:10,failureThreshold:24,timeoutSeconds:5},livenessProbe:{httpGet:{path:'/api/v1/health',port:8080},periodSeconds:30,failureThreshold:3,timeoutSeconds:5}}]}},{dependsOn:[job]});
 new gcp.cloudrunv2.ServiceIamMember('public-api',{project,location:region,name:service.name,role:'roles/run.invoker',member:'allUsers'});
 const channel=new gcp.monitoring.NotificationChannel('teacher-email',{project,displayName:'TropelCare operations',type:'email',labels:{email_address:cfg.require('alertEmail')}});
 new gcp.monitoring.AlertPolicy('server-errors',{project,displayName:'TropelCare 5xx responses',combiner:'OR',notificationChannels:[channel.name],conditions:[{displayName:'5xx sustained for 60 seconds',conditionThreshold:{filter:'resource.type="cloud_run_revision" AND resource.labels.service_name="tropelcare-api" AND metric.type="run.googleapis.com/request_count" AND metric.labels.response_code_class="5xx"',comparison:'COMPARISON_GT',thresholdValue:0,duration:'60s',aggregations:[{alignmentPeriod:'60s',perSeriesAligner:'ALIGN_RATE',crossSeriesReducer:'REDUCE_SUM'}]}}]});
 new gcp.monitoring.AlertPolicy('latency',{project,displayName:'TropelCare p95 latency >800ms',combiner:'OR',notificationChannels:[channel.name],conditions:[{displayName:'Latency sustained 5 minutes',conditionThreshold:{filter:'resource.type="cloud_run_revision" AND resource.labels.service_name="tropelcare-api" AND metric.type="run.googleapis.com/request_latencies"',comparison:'COMPARISON_GT',thresholdValue:800,duration:'300s',aggregations:[{alignmentPeriod:'60s',perSeriesAligner:'ALIGN_PERCENTILE_95'}]}}]});
 const waitingMetric=new gcp.logging.Metric('pool-waiting',{project,name:'tropelcare_pool_waiting',description:'Requests completed while the database pool had pending work',filter:'resource.type="cloud_run_revision" AND resource.labels.service_name="tropelcare-api" AND jsonPayload.dbWaiting>0',metricDescriptor:{metricKind:'DELTA',valueType:'INT64',unit:'1'}});
 new gcp.monitoring.AlertPolicy('pool-pressure',{project,displayName:'TropelCare sustained pool wait',combiner:'OR',notificationChannels:[channel.name],conditions:[{displayName:'Waiting requests for 2 minutes',conditionThreshold:{filter:'resource.type="cloud_run_revision" AND metric.type="logging.googleapis.com/user/tropelcare_pool_waiting"',comparison:'COMPARISON_GT',thresholdValue:0,duration:'120s',aggregations:[{alignmentPeriod:'60s',perSeriesAligner:'ALIGN_RATE',crossSeriesReducer:'REDUCE_SUM'}]}}]},{dependsOn:[waitingMetric]});
 new gcp.monitoring.Dashboard('operations',{project,dashboardJson:JSON.stringify({displayName:'TropelCare event',gridLayout:{columns:2,widgets:[['Requests','run.googleapis.com/request_count','ALIGN_RATE'],['Latency p95 (ms)','run.googleapis.com/request_latencies','ALIGN_PERCENTILE_95'],['Container instances','run.googleapis.com/container/instance_count','ALIGN_MAX']].map(([title,metric,aligner])=>({title,xyChart:{dataSets:[{timeSeriesQuery:{timeSeriesFilter:{filter:`resource.type="cloud_run_revision" AND resource.labels.service_name="tropelcare-api" AND metric.type="${metric}"`,aggregation:{alignmentPeriod:'60s',perSeriesAligner:aligner}}}}]}}))}})});
}
export const apiUrl=service?.uri;
export const healthUrl=service?.uri.apply(url=>`${url}/api/v1/health`);
export const sqlInstanceName=base.requireOutput('sqlInstanceName');
export const imageDigest=image;
