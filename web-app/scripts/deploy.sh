#!/usr/bin/env bash
set -euo pipefail

P=mtd-hackathons
R=us-central1
SVC=vibes-ai
SA="vercel-ui@$P.iam.gserviceaccount.com"
REPO=vibes-ai
IMG="$R-docker.pkg.dev/$P/$REPO/web-app"
BUCKET=gs://mtd-hackathons-artifacts

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
APP_DIR=$(dirname "$SCRIPT_DIR")

env_local() {
  (cd "$APP_DIR" && node -e "
    require('dotenv').config({ path: '.env.local', quiet: true });
    require('dotenv').config({ path: '.env', quiet: true });
    const value = process.env[process.argv[1]];
    if (!value) { console.error(process.argv[1] + ' not set in .env.local'); process.exit(1); }
    process.stdout.write(value);
  " "$1")
}

project_number() { gcloud projects describe "$P" --format='value(projectNumber)'; }
service_url() { echo "https://$SVC-$(project_number).$R.run.app"; }
image_tag() { git -C "$APP_DIR" rev-parse --short HEAD; }

ensure_secret() {
  local name=$1
  if gcloud secrets describe "$name" --project="$P" >/dev/null 2>&1; then
    echo "secret $name exists, keeping current version"
  else
    gcloud secrets create "$name" --project="$P" --replication-policy=automatic
    gcloud secrets versions add "$name" --project="$P" --data-file=-
  fi
}

cmd_bootstrap() {
  gcloud services enable --project="$P" \
    artifactregistry.googleapis.com run.googleapis.com cloudbuild.googleapis.com \
    secretmanager.googleapis.com cloudscheduler.googleapis.com

  gcloud artifacts repositories describe "$REPO" --project="$P" --location="$R" >/dev/null 2>&1 ||
    gcloud artifacts repositories create "$REPO" --project="$P" --location="$R" --repository-format=docker
  gcloud artifacts repositories set-cleanup-policies "$REPO" --project="$P" --location="$R" \
    --policy="$APP_DIR/infra/ar-cleanup-policy.json" --no-dry-run

  env_local CLOUD_SQL_PASSWORD | ensure_secret vibes-cloud-sql-password
  env_local GOOGLE_SERVICE_ACCOUNT_JSON | ensure_secret vibes-sa-json
  env_local GOOGLE_OAUTH_CLIENT_SECRET | ensure_secret vibes-oauth-client-secret
  printf %s "$(openssl rand -hex 32)" | ensure_secret vibes-worker-secret
  printf %s "$(openssl rand -hex 32)" | ensure_secret analyzer-worker-secret
  printf %s "$(openssl rand -base64 32 | tr -d '=+/\n')" | ensure_secret vibes-judge-signup-codes

  gcloud projects add-iam-policy-binding "$P" --member="serviceAccount:$SA" \
    --role=roles/secretmanager.secretAccessor --condition=None >/dev/null
  gcloud projects add-iam-policy-binding "$P" --member="serviceAccount:$SA" \
    --role=roles/cloudsql.client --condition=None >/dev/null

  echo "bootstrap done"
  echo "judges code: gcloud secrets versions access latest --secret=vibes-judge-signup-codes"
  echo "manual step: add $(service_url)/api/auth/google/callback as an authorized"
  echo "redirect URI on OAuth client $(env_local GOOGLE_OAUTH_CLIENT_ID)"
  echo "at https://console.cloud.google.com/apis/credentials?project=$P"
}

cmd_build() {
  local tag
  tag=${TAG:-$(image_tag)}
  gcloud builds submit "$APP_DIR" --project="$P" --tag="$IMG:$tag" \
    --machine-type=e2-highcpu-8 --timeout=1200s
  echo "built $IMG:$tag"
}

cmd_migrate() {
  cd "$APP_DIR"
  node --import tsx --conditions=react-server scripts/db-tunnel.mts &
  local tunnel_pid=$!
  trap 'kill "$tunnel_pid" 2>/dev/null || true' EXIT
  local port=${DB_TUNNEL_PORT:-5433}
  for _ in $(seq 1 30); do
    nc -z 127.0.0.1 "$port" 2>/dev/null && break
    sleep 1
  done
  nc -z 127.0.0.1 "$port" 2>/dev/null || { echo "tunnel never came up on :$port"; exit 1; }
  DATABASE_URL="$(node --import tsx --conditions=react-server scripts/db-tunnel.mts --url)" \
    npx prisma migrate deploy
  kill "$tunnel_pid" 2>/dev/null || true
  trap - EXIT
}

cmd_release() {
  local tag url
  tag=${TAG:-$(image_tag)}
  url=$(service_url)

  gcloud run deploy "$SVC" --project="$P" --region="$R" --image="$IMG:$tag" \
    --service-account="$SA" --allow-unauthenticated \
    --execution-environment=gen2 --no-cpu-throttling \
    --cpu=2 --memory=2Gi --timeout=3600 --concurrency=30 \
    --min-instances=0 --max-instances=8 \
    --set-env-vars="APP_URL=$url,CLOUD_SQL_INSTANCE=$(env_local CLOUD_SQL_INSTANCE),CLOUD_SQL_USER=$(env_local CLOUD_SQL_USER),CLOUD_SQL_DATABASE=$(env_local CLOUD_SQL_DATABASE),GOOGLE_CLOUD_PROJECT=$P,GOOGLE_CLOUD_LOCATION=global,GOOGLE_GENAI_USE_ENTERPRISE=1,GOOGLE_OAUTH_CLIENT_ID=$(env_local GOOGLE_OAUTH_CLIENT_ID),GCS_BUCKET=$(env_local GCS_BUCKET),DATABASE_URL=postgresql://unused:unused@localhost:5432/unused" \
    --set-secrets="CLOUD_SQL_PASSWORD=vibes-cloud-sql-password:latest,GOOGLE_SERVICE_ACCOUNT_JSON=vibes-sa-json:latest,GOOGLE_OAUTH_CLIENT_SECRET=vibes-oauth-client-secret:latest,VIBES_WORKER_SECRET=vibes-worker-secret:latest,ANALYZER_WORKER_SECRET=analyzer-worker-secret:latest,JUDGE_SIGNUP_CODES=vibes-judge-signup-codes:latest"

  if ! curl -sf -o /dev/null --max-time 30 "$url/signin"; then
    local actual
    actual=$(gcloud run services describe "$SVC" --project="$P" --region="$R" --format='value(status.url)')
    echo "computed URL $url does not serve — falling back to $actual for APP_URL"
    gcloud run services update "$SVC" --project="$P" --region="$R" --update-env-vars="APP_URL=$actual"
    url=$actual
  fi
  echo "released $IMG:$tag at $url"
  echo "if not done yet: register $url/api/auth/google/callback as an authorized redirect URI"
}

upsert_job() {
  local name=$1 uri=$2 secret=$3 deadline=$4
  local common=(--project="$P" --location="$R" --schedule="* * * * *" --uri="$uri" \
    --http-method=POST --attempt-deadline="$deadline")
  if gcloud scheduler jobs describe "$name" --project="$P" --location="$R" >/dev/null 2>&1; then
    gcloud scheduler jobs update http "$name" "${common[@]}" --update-headers="Authorization=Bearer $secret"
  else
    gcloud scheduler jobs create http "$name" "${common[@]}" --headers="Authorization=Bearer $secret"
  fi
}

cmd_schedule() {
  local url
  url=$(service_url)
  upsert_job vibes-worker "$url/api/agents/vibes/worker" \
    "$(gcloud secrets versions access latest --secret=vibes-worker-secret --project="$P")" 1800s
  upsert_job analyzer-worker "$url/api/agents/analyzer/worker" \
    "$(gcloud secrets versions access latest --secret=analyzer-worker-secret --project="$P")" 600s
  echo "scheduler jobs vibes-worker and analyzer-worker upserted (every minute)"
}

cmd_cors() {
  local url tmp
  url=$(service_url)
  tmp=$(mktemp -d)
  gcloud storage buckets describe "$BUCKET" --format="json(cors_config)" > "$tmp/current.json"
  node -e "
    const fs = require('fs');
    const [currentPath, outPath, origin] = process.argv.slice(1);
    const cors = JSON.parse(fs.readFileSync(currentPath, 'utf8')).cors_config ?? [];
    if (cors.length === 0) {
      cors.push({ origin: [origin], method: ['GET', 'PUT', 'HEAD'], responseHeader: ['Content-Type'], maxAgeSeconds: 3600 });
    } else {
      for (const entry of cors) {
        entry.origin ??= [];
        if (!entry.origin.includes(origin)) entry.origin.push(origin);
      }
    }
    fs.writeFileSync(outPath, JSON.stringify(cors, null, 2));
    console.log('origins now: ' + [...new Set(cors.flatMap((entry) => entry.origin))].join(', '));
  " "$tmp/current.json" "$tmp/merged.json" "$url"
  gcloud storage buckets update "$BUCKET" --cors-file="$tmp/merged.json"
  rm -rf "$tmp"
  echo "verify with: npm run bucket:lifecycle"
}

cmd_all() {
  cmd_build
  cmd_migrate
  cmd_release
}

case "${1:-}" in
  bootstrap) cmd_bootstrap ;;
  build) cmd_build ;;
  migrate) cmd_migrate ;;
  release) cmd_release ;;
  schedule) cmd_schedule ;;
  cors) cmd_cors ;;
  all) cmd_all ;;
  url) service_url ;;
  *)
    echo "usage: $0 {bootstrap|build|migrate|release|schedule|cors|all|url}"
    exit 1
    ;;
esac
