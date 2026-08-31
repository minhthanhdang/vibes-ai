#!/usr/bin/env bash
set -euo pipefail

P=mtd-hackathons
R=us-central1
SVC=vibes-ai
SA="vercel-ui@$P.iam.gserviceaccount.com"
REPO=vibes-ai
IMG="$R-docker.pkg.dev/$P/$REPO/web-app"
BUCKET=gs://mtd-hackathons-artifacts
GCS="${BUCKET#gs://}"

SQL_INSTANCE="$P:$R:vibes-ai-pg"
SQL_USER=vibes_app
SQL_DB=vibes_ai
OAUTH_CLIENT_ID=655806945364-o7ggvjb97e9u80g5i2esurc7rpgs7mkh.apps.googleusercontent.com

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
APP_DIR=$(dirname "$SCRIPT_DIR")

project_number() { gcloud projects describe "$P" --format='value(projectNumber)'; }
service_url() { echo "https://$SVC-$(project_number).$R.run.app"; }
image_tag() { git -C "$APP_DIR" rev-parse --short HEAD; }

prod_env_pairs() {
  cat <<PAIRS
APP_ENV=production
APP_URL=$(service_url)
CLOUD_SQL_INSTANCE=$SQL_INSTANCE
CLOUD_SQL_USER=$SQL_USER
CLOUD_SQL_DATABASE=$SQL_DB
GOOGLE_CLOUD_PROJECT=$P
GOOGLE_CLOUD_LOCATION=global
GOOGLE_GENAI_USE_ENTERPRISE=1
GOOGLE_OAUTH_CLIENT_ID=$OAUTH_CLIENT_ID
GCS_BUCKET=$GCS
DATABASE_URL=postgresql://unused:unused@localhost:5432/unused
PAIRS
}

secret_value() { gcloud secrets versions access latest --secret="$1" --project="$P"; }

PROD_ENV_LOADED=0

prod_env_load() {
  [[ $PROD_ENV_LOADED == 1 ]] && return 0
  PROD_ENV_PAIRS=()
  while IFS= read -r line; do PROD_ENV_PAIRS+=("$line"); done < <(prod_env_pairs)
  PROD_ENV_PAIRS+=("CLOUD_SQL_PASSWORD=$(secret_value vibes-cloud-sql-password)")
  PROD_ENV_PAIRS+=("GOOGLE_SERVICE_ACCOUNT_JSON=$(secret_value vibes-sa-json)")
  PROD_ENV_PAIRS+=("GOOGLE_OAUTH_CLIENT_SECRET=$(secret_value vibes-oauth-client-secret)")
  PROD_ENV_LOADED=1
}

with_prod_env() {
  prod_env_load
  env "${PROD_ENV_PAIRS[@]}" "$@"
}

cmd_prod_env() {
  prod_env_pairs
  if [[ "${1:-}" == "--secrets" ]]; then
    printf 'CLOUD_SQL_PASSWORD=%s\n' "$(secret_value vibes-cloud-sql-password)"
    printf 'GOOGLE_SERVICE_ACCOUNT_JSON=%s\n' "$(secret_value vibes-sa-json)"
  fi
}

secret_exists() { gcloud secrets describe "$1" --project="$P" >/dev/null 2>&1; }

ensure_secret() {
  local name=$1
  if secret_exists "$name"; then
    echo "secret $name exists, keeping current version"
  else
    gcloud secrets create "$name" --project="$P" --replication-policy=automatic
    gcloud secrets versions add "$name" --project="$P" --data-file=-
  fi
}

prompt_secret() {
  local name=$1 label=$2 value
  if secret_exists "$name"; then
    echo "secret $name exists, keeping current version"
    return 0
  fi
  read -rsp "$label: " value
  echo
  printf %s "$value" | ensure_secret "$name"
}

cmd_bootstrap() {
  gcloud services enable --project="$P" \
    artifactregistry.googleapis.com run.googleapis.com cloudbuild.googleapis.com \
    secretmanager.googleapis.com cloudscheduler.googleapis.com

  gcloud artifacts repositories describe "$REPO" --project="$P" --location="$R" >/dev/null 2>&1 ||
    gcloud artifacts repositories create "$REPO" --project="$P" --location="$R" --repository-format=docker
  gcloud artifacts repositories set-cleanup-policies "$REPO" --project="$P" --location="$R" \
    --policy="$APP_DIR/infra/ar-cleanup-policy.json" --no-dry-run

  prompt_secret vibes-cloud-sql-password "Cloud SQL password for $SQL_USER"
  if secret_exists vibes-sa-json; then
    echo "secret vibes-sa-json exists, keeping current version"
  else
    gcloud iam service-accounts keys create - --iam-account="$SA" --project="$P" |
      ensure_secret vibes-sa-json
  fi
  prompt_secret vibes-oauth-client-secret "OAuth client secret for $OAUTH_CLIENT_ID"
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
  echo "redirect URI on OAuth client $OAUTH_CLIENT_ID"
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
  with_prod_env node --import tsx --conditions=react-server scripts/db-tunnel.mts &
  local tunnel_pid=$!
  trap 'kill "$tunnel_pid" 2>/dev/null || true' EXIT
  local port=${DB_TUNNEL_PORT:-5433}
  for _ in $(seq 1 30); do
    nc -z 127.0.0.1 "$port" 2>/dev/null && break
    sleep 1
  done
  nc -z 127.0.0.1 "$port" 2>/dev/null || { echo "tunnel never came up on :$port"; exit 1; }
  DATABASE_URL="$(with_prod_env node --import tsx --conditions=react-server scripts/db-tunnel.mts --url)" \
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
    --set-env-vars="$(prod_env_pairs | paste -sd, -)" \
    --set-secrets="CLOUD_SQL_PASSWORD=vibes-cloud-sql-password:latest,GOOGLE_SERVICE_ACCOUNT_JSON=vibes-sa-json:latest,GOOGLE_OAUTH_CLIENT_SECRET=vibes-oauth-client-secret:latest,VIBES_WORKER_SECRET=vibes-worker-secret:latest,ANALYZER_WORKER_SECRET=analyzer-worker-secret:latest,JUDGE_SIGNUP_CODES=vibes-judge-signup-codes:latest"

  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$url/signin" || true)
  if [[ $code == 5* ]]; then
    echo "the revision at $url answers $code on /signin — it is serving errors, not missing."
    echo "check the environment it booted with: $0 prod-env"
    echo "and the logs: gcloud run services logs read $SVC --project=$P --region=$R"
    exit 1
  fi
  if [[ $code != 2* && $code != 3* ]]; then
    local actual
    actual=$(gcloud run services describe "$SVC" --project="$P" --region="$R" --format='value(status.url)')
    echo "computed URL $url does not serve ($code) — falling back to $actual for APP_URL"
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

add_cors_origin() {
  local bucket=$1 origin=$2 tmp
  tmp=$(mktemp -d)
  gcloud storage buckets describe "$bucket" --format="json(cors_config)" > "$tmp/current.json"
  node -e "
    const fs = require('fs');
    const [currentPath, outPath, origin] = process.argv.slice(1);
    const cors = JSON.parse(fs.readFileSync(currentPath, 'utf8')).cors_config ?? [];
    if (cors.length === 0) {
      cors.push({ origin: [origin], method: ['GET', 'PUT', 'HEAD'], responseHeader: ['Content-Type', 'Cache-Control'], maxAgeSeconds: 3600 });
    } else {
      for (const entry of cors) {
        entry.origin ??= [];
        if (!entry.origin.includes(origin)) entry.origin.push(origin);
      }
    }
    fs.writeFileSync(outPath, JSON.stringify(cors, null, 2));
    console.log('origins now: ' + [...new Set(cors.flatMap((entry) => entry.origin))].join(', '));
  " "$tmp/current.json" "$tmp/merged.json" "$origin"
  gcloud storage buckets update "$bucket" --cors-file="$tmp/merged.json"
  rm -rf "$tmp"
}

cmd_cors() {
  add_cors_origin "$BUCKET" "$(service_url)"
  echo "verify with: npm run bucket:lifecycle"
}

cmd_cors_dev() {
  local bucket=${1:-}
  if [[ -z $bucket ]]; then
    echo "usage: $0 cors-dev <DEV_BUCKET>   (the bucket named in .env.local)"
    exit 1
  fi
  add_cors_origin "gs://${bucket#gs://}" "${DEV_ORIGIN:-http://localhost:12000}"
  echo "the browser can now PUT uploads straight to gs://${bucket#gs://} from dev"
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
  cors-dev) cmd_cors_dev "${2:-}" ;;
  all) cmd_all ;;
  url) service_url ;;
  prod-env) cmd_prod_env "${2:-}" ;;
  prod-run) shift; with_prod_env "$@" ;;
  *)
    echo "usage: $0 {bootstrap|build|migrate|release|schedule|cors|all|url}"
    echo "       $0 cors-dev <DEV_BUCKET>"
    echo "       $0 prod-env [--secrets]"
    echo "       $0 prod-run <command...>"
    exit 1
    ;;
esac
