# Deploy Pakao backend to Google Cloud Run

Use this for **zero cold starts** (e.g. hackathon demos). Cloud Run with `min-instances: 1` keeps one instance always warm (~$5/month).

## Setup gcloud and config

Do this once (or on a new machine).

**1. Install gcloud CLI** (if needed)

- macOS (Homebrew): `brew install --cask google-cloud-sdk`
- Or: [Install from Google](https://cloud.google.com/sdk/docs/install)

**2. Log in and set default project**

```bash
# Log in (opens browser; use the Google account that has access to your GCP project)
gcloud auth login

# Optional: use an application-default credential for local SDK use
gcloud auth application-default login

# List your projects to get the project ID
gcloud projects list

# Set default project (replace YOUR_PROJECT_ID with the ID from the list)
gcloud config set project YOUR_PROJECT_ID

# Optional: set default region so you can omit --region in later commands
gcloud config set run/region us-central1
```

**3. Verify**

```bash
gcloud config list
# Should show: project = YOUR_PROJECT_ID, and optionally run/region
```

**4. Enable required APIs**

```bash
gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com
```

## 1. Store secrets (recommended)

Don’t put API keys in the image or in plain env. Use Secret Manager:

```bash
# Gemini API key
echo -n "YOUR_GEMINI_API_KEY" | gcloud secrets create gemini-api-key --data-file=- 2>/dev/null || echo -n "YOUR_GEMINI_API_KEY" | gcloud secrets versions add gemini-api-key --data-file=-

# Firebase service account (JSON from serviceAccountKey.json)
gcloud secrets create firebase-sa --data-file=./serviceAccountKey.json 2>/dev/null || gcloud secrets versions add firebase-sa --data-file=./serviceAccountKey.json
```

## 2. Build and push image

From the **repo root** (parent of `server/`):

```bash
# One-time: create Artifact Registry repo
gcloud artifacts repositories create cookai-backend --repository-format=docker --location=us-central1

# Build and push (replace YOUR_PROJECT_ID)
gcloud builds submit --tag us-central1-docker.pkg.dev/cookingai-ec043/cookai-backend/server ./server
```

## 3. Deploy with min-instances: 1

Replace `YOUR_PROJECT_ID` and adjust region if needed. This keeps one instance always on:

```bash
export PROJECT_ID=cookingai-ec043
export REGION=us-central1
export IMAGE=us-central1-docker.pkg.dev/${cookingai-ec043}/cookai-backend/server

gcloud run deploy cookai-backend \
  --image $IMAGE \
  --region $REGION \
  --platform managed \
  --min-instances 1 \
  --max-instances 5 \
  --allow-unauthenticated \
  --memory 512Mi \
  --set-secrets "GEMINI_API_KEY=gemini-api-key:latest" \
  --set-secrets "FIREBASE_SERVICE_ACCOUNT_JSON=firebase-sa:latest"
```

If you didn’t create secrets, use env vars instead (less secure):

```bash
gcloud run deploy cookai-backend \
  --image $IMAGE \
  --region $REGION \
  --min-instances 1 \
  --allow-unauthenticated \
  --set-env-vars "GEMINI_API_KEY=your_key" \
  --set-env-vars "FIREBASE_SERVICE_ACCOUNT_JSON=$(cat serviceAccountKey.json | jq -c .)"
```

After deploy, note the **service URL** (e.g. `https://cookai-backend-xxxxx-uc.a.run.app`).

## 4. Point frontend at Cloud Run

1. **Netlify redirects**  
   In `netlify.toml`, set the backend base URL to your Cloud Run URL:
   - `to = "https://YOUR_CLOUD_RUN_URL/api/:splat"` for `/api/*`
   - `to = "https://YOUR_CLOUD_RUN_URL/share/:splat"` for `/share/*`

2. **WebSocket**  
   In Netlify (or your build env), set:
   - `VITE_LIVE_WS_URL=https://YOUR_CLOUD_RUN_URL`  
   so the client uses `wss://YOUR_CLOUD_RUN_URL/ws`.

3. Redeploy the frontend so the new redirects and env are used.

## 5. Verify

- Open `https://YOUR_CLOUD_RUN_URL/api/health` — should return `{"status":"ok",...}`.
- Use the app: create recipe, start cooking, etc. No cold-start delay.

## Cost (ballpark)

- **min-instances: 1** ≈ ~$5/month for one always-on instance.
- Without min-instances (scale to zero): free tier is usually enough; first request after idle has a cold start.
