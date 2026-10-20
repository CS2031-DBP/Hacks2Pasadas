#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "${1:-}" == --destroy ]]; then exec infra/destroy.sh; fi
skip=false
if [[ "${1:-}" == --skip-seed ]]; then skip=true; elif [[ $# -gt 0 ]]; then echo 'Unknown option' >&2; exit 2; fi
for tool in gcloud pulumi node npm; do command -v "$tool" >/dev/null || { echo "Missing $tool" >&2; exit 1; }; done
: "${PROJECT_ID:?Set PROJECT_ID}" "${BILLING_ACCOUNT:?Set BILLING_ACCOUNT}" "${ALERT_EMAIL:?Set ALERT_EMAIL}" "${CORS_ORIGINS:?Set CORS_ORIGINS}"
REGION=${REGION:-us-central1}
STACK=${STACK:-event}
FOUNDATION_STACK=${FOUNDATION_STACK:-$STACK}
APPLICATION_STACK=${APPLICATION_STACK:-$STACK}
[[ -n "$(gcloud auth list --filter=status:ACTIVE --format='value(account)')" ]] || { echo 'No active gcloud account'; exit 1; }
gcloud auth application-default print-access-token >/dev/null
gcloud projects describe "$PROJECT_ID" --format='value(projectId)' >/dev/null
[[ "$(gcloud billing projects describe "$PROJECT_ID" --format='value(billingEnabled)')" == True ]] || { echo 'Billing is not enabled'; exit 1; }
echo "Deploying project=$PROJECT_ID region=$REGION foundation=$FOUNDATION_STACK application=$APPLICATION_STACK"
npm ci --prefix infra --ignore-scripts
npm run typecheck --prefix infra
cd infra/foundation
pulumi stack select "$FOUNDATION_STACK" --create
pulumi config set gcp:project "$PROJECT_ID"
pulumi config set gcp:region "$REGION"
pulumi config set billingAccount "$BILLING_ACCOUNT"
pulumi up --yes
repository=$(pulumi stack output repositoryUrl)
build_account=$(pulumi stack output buildServiceAccount)
build_source=$(pulumi stack output buildSourceBucket)
build_logs=$(pulumi stack output buildLogBucket)
# Fully qualified stack name avoids local/organization naming assumptions.
foundation_ref=$(pulumi stack --show-name --fully-qualify-stack-names)
cd ../..
tag=$(git rev-parse --short=12 HEAD 2>/dev/null || date -u +%Y%m%d%H%M%S)
gcloud builds submit --project "$PROJECT_ID" --service-account "$build_account" --gcs-source-staging-dir "gs://$build_source/source" --gcs-log-dir "gs://$build_logs/logs" --tag "$repository/api:$tag" .
digest=$(gcloud artifacts docker images describe "$repository/api:$tag" --project "$PROJECT_ID" --format='value(image_summary.digest)')
[[ "$digest" == sha256:* ]] || { echo 'Missing image digest'; exit 1; }
cd infra/application
pulumi stack select "$APPLICATION_STACK" --create
pulumi config set foundationStack "$foundation_ref"
pulumi config set gcp:project "$PROJECT_ID"
pulumi config set gcp:region "$REGION"
pulumi config set image "$repository/api@$digest"
pulumi config set corsOrigins "$CORS_ORIGINS"
pulumi config set alertEmail "$ALERT_EMAIL"
# Update the job first on redeploy so a revision needing a new schema cannot
# block the migration that makes it ready. A new stack has publish absent/false.
job_urn=$(pulumi stack export | node -e 'let input="";process.stdin.on("data",chunk=>input+=chunk);process.stdin.on("end",()=>{const resources=JSON.parse(input).deployment?.resources||[];process.stdout.write(resources.find(r=>r.type==="gcp:cloudrunv2/job:Job")?.urn||"");});')
if [[ -n "$job_urn" ]]; then pulumi up --target "$job_urn" --yes; else pulumi up --yes; fi
if [[ "$skip" == false ]]; then
 job=$(pulumi stack output jobName)
 gcloud run jobs execute "$job" --project "$PROJECT_ID" --region "$REGION" --wait
fi
pulumi config set publish true
pulumi up --yes
API_URL=$(pulumi stack output apiUrl)
export API_URL
# Secret remains in process environment, never an argument or log line.
CREDENTIALS_SECRET=$(gcloud secrets versions access latest --secret=tropelcare-credentials-secret --project "$PROJECT_ID")
export CREDENTIALS_SECRET
cd ../..
node scripts/smoke.mjs
unset CREDENTIALS_SECRET
printf 'API: %s\nDocs: %s/docs\n' "$API_URL" "$API_URL"
