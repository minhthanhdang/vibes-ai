#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

PROJECT_ID=mtd-hackathons
REGION=us-central1

gcloud functions deploy vertex-kill-switch \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --gen2 \
  --runtime=nodejs22 \
  --source=. \
  --entry-point=killVertex \
  --trigger-topic=vertex-budget-kill \
  --service-account="vertex-kill-switch@${PROJECT_ID}.iam.gserviceaccount.com" \
  --set-env-vars="PROJECT_ID=${PROJECT_ID}" \
  --memory=256Mi \
  --max-instances=1
