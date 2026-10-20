#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
: "${PROJECT_ID:?Set PROJECT_ID}"
STACK=${STACK:-event}
FOUNDATION_STACK=${FOUNDATION_STACK:-$STACK}
APPLICATION_STACK=${APPLICATION_STACK:-$STACK}
echo "Destroy project=$PROJECT_ID foundation=$FOUNDATION_STACK application=$APPLICATION_STACK"
read -r -p "Type the project ID to confirm permanent deletion: " confirmation
[[ "$confirmation" == "$PROJECT_ID" ]] || exit 1
cd foundation
pulumi stack select "$FOUNDATION_STACK"
[[ "$(pulumi stack output projectId)" == "$PROJECT_ID" ]] || { echo 'Wrong project'; exit 1; }
read -r -p 'Export database to an existing private gs://bucket/path.sql.gz before deletion? (blank skips): ' backup
if [[ -n "$backup" ]]; then
 [[ "$backup" == gs://* ]] || exit 2
 instance=$(pulumi stack output sqlInstanceName)
 gcloud sql export sql "$instance" "$backup" --database=tropelcare --project "$PROJECT_ID"
fi
cd ../application
pulumi stack select "$APPLICATION_STACK"
[[ "$(pulumi config get gcp:project)" == "$PROJECT_ID" ]] || { echo 'Wrong application project'; exit 1; }
pulumi destroy --yes
cd ../foundation
pulumi destroy --yes
