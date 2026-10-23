#!/usr/bin/env bash
# Cloud Run: builds from the Dockerfile and runs at most one instance, scaled to zero when idle (free tier).
# State: the case store is SQLite on the instance's own disk, so it lasts only as long as the instance. It resets on a cold
# start. Fine for a judge who starts a case and plays it through in one sitting; use Fly.io (fly.toml) if the store must
# survive restarts.
# One instance only: a second instance would have its own empty store, and a case made on the first would answer 404 there.
# Setting PUBLIC_URL below creates a second revision, so do not start cases until the script prints the live URL.
#   PROJECT=<your gcp project id> REGION=us-west1 bash deploy/cloudrun.sh
set -euo pipefail
PROJECT="${PROJECT:?set PROJECT to your GCP project id}"
REGION="${REGION:-us-west1}"
SERVICE="${SERVICE:-after-loss-desk}"
gcloud --project "$PROJECT" services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
gcloud --project "$PROJECT" run deploy "$SERVICE" --source . --region "$REGION" --allow-unauthenticated \
  --port 8300 --min-instances 0 --max-instances 1 --memory 512Mi --cpu 1 --timeout 300 \
  --set-env-vars "AFTERLOSS_DB=/tmp/afterloss.sqlite3"
URL="$(gcloud --project "$PROJECT" run services describe "$SERVICE" --region "$REGION" --format 'value(status.url)')"
gcloud --project "$PROJECT" run services update "$SERVICE" --region "$REGION" --update-env-vars "PUBLIC_URL=$URL"
echo "Live at $URL  (MCP endpoint: $URL/mcp)"
