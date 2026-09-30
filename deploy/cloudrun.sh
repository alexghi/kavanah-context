#!/usr/bin/env bash
#
# Kavannah API on Google Cloud Run.
#
#   deploy/cloudrun.sh setup     create/link the GCP project, enable APIs, create the service account
#   deploy/cloudrun.sh secrets   push ANTHROPIC_API_KEY and KAVANNAH_ACCESS_KEYS from .env to Secret Manager
#   deploy/cloudrun.sh deploy    build the image from the Dockerfile with Cloud Build and deploy it
#   deploy/cloudrun.sh keys      push the current KAVANNAH_ACCESS_KEYS and roll a new revision
#   deploy/cloudrun.sh url       print the service URL
#   deploy/cloudrun.sh smoke     health check + one mock analysis with the first access key
#   deploy/cloudrun.sh logs      tail recent logs
#   deploy/cloudrun.sh all       setup + secrets + deploy + smoke
#
# Non-secret settings live in deploy/cloudrun.env (committed); secrets are read from .env
# (never committed) and stored in Secret Manager. Every gcloud call passes --project, so the
# user's default gcloud project is never changed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${KAVANNAH_ENV_FILE:-$ROOT/.env}"
# shellcheck disable=SC1091
[ -f "$ROOT/deploy/cloudrun.env" ] && . "$ROOT/deploy/cloudrun.env"

PROJECT="${KAVANNAH_GCP_PROJECT:?set KAVANNAH_GCP_PROJECT (deploy/cloudrun.env)}"
REGION="${KAVANNAH_GCP_REGION:-europe-west1}"
SERVICE="${KAVANNAH_GCP_SERVICE:-kavannah-api}"
BILLING="${KAVANNAH_GCP_BILLING_ACCOUNT:-}"
SA_NAME="${KAVANNAH_GCP_SERVICE_ACCOUNT:-kavannah-api}"
SA="$SA_NAME@$PROJECT.iam.gserviceaccount.com"
SECRET_API_KEY="kavannah-anthropic-api-key"
SECRET_ACCESS_KEYS="kavannah-access-keys"
SECRET_OPENROUTER_KEY="kavannah-openrouter-key"
MAX_INSTANCES="${KAVANNAH_GCP_MAX_INSTANCES:-2}"

say() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# Value of a variable from .env (shell environment wins, like the server itself). Never echoed.
envval() {
  node -e 'try { process.loadEnvFile(process.argv[1]); } catch {} process.stdout.write(process.env[process.argv[2]] ?? "");' "$ENV_FILE" "$1"
}

gc() { gcloud --project "$PROJECT" --quiet "$@"; }

cmd_setup() {
  say "Project $PROJECT"
  if ! gcloud projects describe "$PROJECT" >/dev/null 2>&1; then
    gcloud projects create "$PROJECT" --name="Kavannah" --quiet
  fi
  if [ -n "$BILLING" ]; then
    say "Linking billing account $BILLING"
    gcloud billing projects link "$PROJECT" --billing-account="$BILLING" --quiet
  else
    gcloud billing projects describe "$PROJECT" --format='value(billingEnabled)' | grep -q True || die "Billing is not enabled on $PROJECT. Set KAVANNAH_GCP_BILLING_ACCOUNT and rerun setup."
  fi
  say "Enabling APIs (Cloud Run, Cloud Build, Artifact Registry, Secret Manager)"
  gc services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com
  say "Service account $SA"
  if ! gc iam service-accounts describe "$SA" >/dev/null 2>&1; then
    gc iam service-accounts create "$SA_NAME" --display-name="Kavannah API (Cloud Run runtime)"
  fi
}

push_secret() { # name value
  local name="$1" value="$2"
  [ -n "$value" ] || die "Empty value for secret $name (check $ENV_FILE)."
  if ! gc secrets describe "$name" >/dev/null 2>&1; then
    gc secrets create "$name" --replication-policy=automatic
  fi
  printf '%s' "$value" | gc secrets versions add "$name" --data-file=-
  gc secrets add-iam-policy-binding "$name" --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor >/dev/null
}

require_access_keys() {
  local keys
  keys="$(envval KAVANNAH_ACCESS_KEYS)"
  [ -n "$keys" ] || die "No access keys in $ENV_FILE. The hosted server refuses to run open; create one with: npm run keys -- add <name>"
}

cmd_secrets() {
  require_access_keys
  say "Pushing secrets to Secret Manager"
  push_secret "$SECRET_API_KEY" "$(envval ANTHROPIC_API_KEY)"
  push_secret "$SECRET_ACCESS_KEYS" "$(envval KAVANNAH_ACCESS_KEYS)"
  if [ -n "$(envval KAVANNAH_OPENROUTER_KEY)" ]; then
    push_secret "$SECRET_OPENROUTER_KEY" "$(envval KAVANNAH_OPENROUTER_KEY)"
  else
    echo "  (no KAVANNAH_OPENROUTER_KEY in $ENV_FILE: OpenRouter failover stays off)"
  fi
}

cmd_deploy() {
  require_access_keys
  local model effort search fast searchModel secrets
  model="$(envval KAVANNAH_MODEL)"; model="${model:-claude-opus-5-5}"
  fast="$(envval KAVANNAH_MODEL_FAST)"
  searchModel="$(envval KAVANNAH_SEARCH_MODEL)"
  effort="$(envval KAVANNAH_EFFORT)"; effort="${effort:-medium}"
  search="$(envval KAVANNAH_WEB_SEARCH)"; search="${search:-1}"
  secrets="ANTHROPIC_API_KEY=$SECRET_API_KEY:latest,KAVANNAH_ACCESS_KEYS=$SECRET_ACCESS_KEYS:latest"
  if gc secrets describe "$SECRET_OPENROUTER_KEY" >/dev/null 2>&1; then secrets="$secrets,KAVANNAH_OPENROUTER_KEY=$SECRET_OPENROUTER_KEY:latest"; fi
  say "Deploying $SERVICE to $REGION (judge $model, fast ${fast:-same}, search ${searchModel:-fast tier}, effort $effort, web search $search)"
  gc run deploy "$SERVICE" \
    --source "$ROOT" \
    --region "$REGION" \
    --service-account "$SA" \
    --allow-unauthenticated \
    --port 8080 \
    --cpu 1 --memory 512Mi \
    --concurrency 8 \
    --timeout 300 \
    --min-instances 0 --max-instances "$MAX_INSTANCES" \
    --set-env-vars "^|^KAVANNAH_HOST=0.0.0.0|KAVANNAH_TRUST_PROXY=1|KAVANNAH_MODEL=$model|KAVANNAH_MODEL_FAST=$fast|KAVANNAH_SEARCH_MODEL=$searchModel|KAVANNAH_EFFORT=$effort|KAVANNAH_WEB_SEARCH=$search" \
    --set-secrets "$secrets"
  say "Deployed: $(cmd_url)"
}

cmd_keys() {
  require_access_keys
  say "Updating access keys"
  push_secret "$SECRET_ACCESS_KEYS" "$(envval KAVANNAH_ACCESS_KEYS)"
  # Secrets are read when an instance starts; roll a revision so running instances pick them up.
  gc run services update "$SERVICE" --region "$REGION" --update-env-vars "KAVANNAH_KEYS_UPDATED=$(date -u +%Y%m%dT%H%M%SZ)"
  say "Keys active on $(cmd_url)"
}

cmd_url() {
  gc run services describe "$SERVICE" --region "$REGION" --format='value(status.url)'
}

cmd_smoke() {
  local url key body
  url="$(cmd_url)"
  key="$(envval KAVANNAH_ACCESS_KEYS | cut -d, -f1 | cut -d: -f2-)"
  say "GET $url/api/health"
  curl -fsS "$url/api/health" -H "authorization: Bearer $key"; echo
  say "POST $url/api/analyze (mock, no model call)"
  body='{"post":{"platform":"x","url":"https://x.com/kavannah_demo/status/1000000000000000007","text":"smoke test"},"options":{"mock":true}}'
  curl -fsS "$url/api/analyze" -H "authorization: Bearer $key" -H 'content-type: application/json' -d "$body" | head -c 300; echo
  say "OK"
}

cmd_logs() {
  gc run services logs read "$SERVICE" --region "$REGION" --limit "${1:-100}"
}

case "${1:-}" in
  setup) cmd_setup ;;
  secrets) cmd_secrets ;;
  deploy) cmd_deploy ;;
  keys) cmd_keys ;;
  url) cmd_url ;;
  smoke) cmd_smoke ;;
  logs) cmd_logs "${2:-100}" ;;
  all) cmd_setup; cmd_secrets; cmd_deploy; cmd_smoke ;;
  *) sed -n '2,20p' "$0"; exit 2 ;;
esac
