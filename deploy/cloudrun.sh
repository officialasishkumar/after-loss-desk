#!/usr/bin/env bash
# Cloud Run (the path used for Tephra). Builds from the Dockerfile and runs one always-on instance.
# State: Cloud Run's disk is ephemeral; the case store resets when the instance is replaced. Fine for judges who start
# their own case and play it through in one sitting; use Fly.io (fly.toml) if the store must survive restarts.
#   PROJECT=<your personal gcp project> REGION=us-west1 bash deploy/cloudrun.sh
set -euo pipefail
PROJECT="${PROJECT:?set PROJECT to your personal GCP project id}"
REGION="${REGION:-us-west1}"
SERVICE="${SERVICE:-after-loss-desk}"
gcloud --project "$PROJECT" services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
gcloud --project "$PROJECT" run deploy "$SERVICE" --source . --region "$REGION" --allow-unauthenticated \
  --port 8300 --min-instances 1 --max-instances 2 --memory 512Mi --cpu 1 --timeout 300 \
  --set-env-vars "AFTERLOSS_DB=/tmp/afterloss.sqlite3"
URL="$(gcloud --project "$PROJECT" run services describe "$SERVICE" --region "$REGION" --format 'value(status.url)')"
gcloud --project "$PROJECT" run services update "$SERVICE" --region "$REGION" --update-env-vars "PUBLIC_URL=$URL"
echo "Live at $URL  (MCP endpoint: $URL/mcp)"
