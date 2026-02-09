#!/usr/bin/env bash
# Build and deploy CookAI backend to Google Cloud Run.
# Run from repo root: ./scripts/deploy-cloud-run.sh
# Override: PROJECT_ID=myproject REGION=europe-west1 ./scripts/deploy-cloud-run.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

PROJECT_ID="${PROJECT_ID:-cookingai-ec043}"
REGION="${REGION:-us-central1}"
IMAGE="us-central1-docker.pkg.dev/${PROJECT_ID}/cookai-backend/server"

echo "Building image (context: ./server)..."
gcloud builds submit --tag "$IMAGE" ./server

echo "Deploying to Cloud Run..."
gcloud run deploy cookai-backend \
  --image "$IMAGE" \
  --region "$REGION" \
  --platform managed \
  --min-instances 1 \
  --max-instances 5 \
  --allow-unauthenticated \
  --memory 512Mi \
  --set-secrets "GEMINI_API_KEY=gemini-api-key:latest" \
  --set-secrets "FIREBASE_SERVICE_ACCOUNT_JSON=firebase-sa:latest"

echo "Done. Service URL:"
gcloud run services describe cookai-backend --region "$REGION" --format='value(status.url)'
